from datetime import datetime

from celery.task.control import revoke
from flask import current_app, request
from flask_restplus import Namespace, Resource

from app.celery_app import make_celery
from app.connections import db
from app.core.pipelines import construct_pipeline
from app.schema import (
    pipeline_run,
    pipeline_run_config,
    pipeline_run_spec,
    experiment_spec,
    experiment,
    experiments,
    status_update,
    pipeline_step,
)
import app.models as models


api = Namespace('experiments', description='Managing experiments')

# NOTE: even though some models are not directly, they are `Nested`
# inside others and therefore have to be defined here. E.g.
# `experiment_spec` uses `pipeline_run_spec` which uses
# `pipeline_run_config` (both of which are not directly used in this
# namespace).
api.models[pipeline_run.name] = pipeline_run
api.models[pipeline_run_config.name] = pipeline_run_config
api.models[pipeline_run_spec.name] = pipeline_run_spec
api.models[experiment.name] = experiment
api.models[experiment_spec.name] = experiment_spec
api.models[experiments.name] = experiments
api.models[status_update.name] = status_update
api.models[pipeline_step.name] = pipeline_step


@api.route('/')
class ExperimentList(Resource):
    @api.doc('get_experiments')
    @api.marshal_with(experiments)
    def get(self):
        """Fetches all experiments.

        The experiments are either in queue, running or already
        completed.

        """
        # TODO: the nested pipeline_runs should be shown.
        experiments = models.Experiment.query.all()
        # return {'experiments': [exp.as_dict() for exp in experiments]}, 200
        return {'experiments': [exp.__dict__ for exp in experiments]}, 200

    @api.doc('start_experiment')
    @api.expect(experiment_spec)
    @api.marshal_with(experiment, code=201, description='Queued experiment')
    def post(self):
        """Queues a new experiment."""
        # TODO: possible use marshal() on the post_data
        # https://flask-restplus.readthedocs.io/en/stable/api.html#flask_restplus.marshal
        #       to make sure the default values etc. are filled in.
        post_data = request.get_json()

        # TODO: maybe we can expect a datetime (in the schema) so we
        #       do not have to parse it here.
        #       https://flask-restplus.readthedocs.io/en/stable/api.html#flask_restplus.fields.DateTime
        scheduled_start = post_data['scheduled_start']
        # scheduled_start = scheduled_start.replace('Z', '+00:00')
        scheduled_start = datetime.fromisoformat(scheduled_start)

        pipeline_runs = []
        pipeline_run_spec = post_data['pipeline_run_spec']
        for pipeline_description in post_data['pipeline_descriptions']:
            pipeline_run_spec['pipeline_description'] = pipeline_description
            pipeline = construct_pipeline(**post_data['pipeline_run_spec'])

            # TODO: This can be made more efficient, since the pipeline
            #       is the same for all pipeline runs. The only
            #       difference is the parameters. So all the jobs could
            #       be created in batch.
            # Create Celery object with the Flask context and construct the
            # kwargs for the job.
            celery = make_celery(current_app)
            celery_job_kwargs = {
                'experiment_uuid': post_data['experiment_uuid'],
                'pipeline_description': pipeline.to_dict(),
                'run_config': pipeline_run_spec['run_config'],
            }

            # Start the run as a background task on Celery. Due to circular
            # imports we send the task by name instead of importing the
            # function directly.
            res = celery.send_task(
                'app.core.tasks.start_non_interactive_pipeline_run',
                eta=scheduled_start,
                kwargs=celery_job_kwargs
            )

            non_interactive_run = {
                'experiment_uuid': post_data['experiment_uuid'],
                'run_uuid': res.id,
                'pipeline_uuid': pipeline.properties['uuid'],
                'status': 'PENDING',
                'scheduled_start': scheduled_start,
            }
            db.session.add(models.NonInteractiveRun(**non_interactive_run))

            # TODO: this code is also in `namespace_runs`. Maybe move it to
            #       a function so that it can be reused and the code becomes
            #       dry.
            # Set an initial value for the status of the pipline steps that
            # will be run.
            step_uuids = [s.properties['uuid'] for s in pipeline.steps]
            step_statuses = []
            for step_uuid in step_uuids:
                step_statuses.append(models.NonInteractiveRunStep(**{
                    'experiment_uuid': post_data['experiment_uuid'],
                    'run_uuid': res.id,
                    'step_uuid': step_uuid,
                    'status': 'PENDING'
                }))
            db.session.bulk_save_objects(step_statuses)
            db.session.commit()

            non_interactive_run['step_statuses'] = step_statuses
            pipeline_runs.append(non_interactive_run)

        experiment = {
            'experiment_uuid': post_data['experiment_uuid'],
            'pipeline_uuid': post_data['pipeline_uuid'],
            'scheduled_start': scheduled_start,
        }
        db.session.add(models.Experiment(**experiment))
        db.session.commit()

        experiment['pipeline_runs'] = pipeline_runs
        return experiment, 201


@api.route('/<string:experiment_uuid>')
@api.param('experiment_uuid', 'UUID of experiment')
@api.response(404, 'Experiment not found')
class Experiment(Resource):
    @api.doc('get_experiment')
    @api.marshal_with(experiment, code=200)
    def get(self, experiment_uuid):
        """Fetches an experiment given its UUID."""
        run = models.Experiment.query.get_or_404(experiment_uuid,
                                                 description='Run not found')
        return run.__dict__

    @api.doc('set_experiment_status')
    @api.expect(status_update)
    def put(self, experiment_uuid):
        """Sets the status of an experiment."""
        post_data = request.get_json()

        res = models.Experiment.query.filter_by(
            experiment_uuid=experiment_uuid
        ).update({
            'status': post_data['status']
        })

        if res:
            db.session.commit()

        return {'message': 'Status was updated successfully'}, 200

    # TODO: We will make it possible to stop an entire experiment, but
    #       not stopping a particular pipeline run of an experiment.
    @api.doc('delete_experiment')
    @api.response(200, 'Experiment terminated')
    def delete(self, run_uuid):
        """Stops an experiment given its UUID."""
        # TODO: we could specify more options when deleting the run.
        # TODO: error handling.
        # TODO: possible set status of steps and Run to "REVOKED"
        # TODO: https://stackoverflow.com/questions/39191238/revoke-a-task-from-celery
        # NOTE: delete new pipeline files that were created for this specific run?

        # Stop the run, whether it is in the queue or whether it is
        # actually running.
        revoke(run_uuid, terminate=True)

        run_res = models.ScheduledRun.query.filter_by(
            run_uuid=run_uuid
        ).update({
            'status': 'REVOKED'
        })

        step_res = models.ScheduledStepStatus.query.filter_by(
            run_uuid=run_uuid
        ).update({
            'status': 'REVOKED'
        })

        if run_res and step_res:
            db.session.commit()

        return {'message': 'Run termination was successful'}, 200


@api.route(
    '/<string:experiment_uuid>/<string:run_uuid>',
    doc={
        'description': 'Set and get execution status of pipeline runs in an experiment.'
    }
)
@api.param('experiment_uuid', 'UUID of Experiment')
@api.param('run_uuid', 'UUID of Run')
@api.response(404, 'Pipeline step not found')
class PipelineRun(Resource):
    @api.doc('get_pipeline_run')
    @api.marshal_with(pipeline_run, code=200)
    def get(self, experiment_uuid, run_uuid):
        """Fetch a pipeline run of an experiment given their ids."""
        # TODO: Returns the status and logs. Of course logs are empty if
        #       the step is not executed yet.
        step = models.NonInteractiveRun.query.get_or_404(
            ident=(experiment_uuid, run_uuid),
            description='Scheduled run and step combination not found'
        )
        return step.__dict__

    @api.doc('set_pipeline_run_status')
    @api.expect(status_update)
    def put(self, experiment_uuid, run_uuid):
        """Set the status of a scheduleld run step."""
        post_data = request.get_json()

        # TODO: don't we want to do this async? Since otherwise the API
        #       call might be blocking another since they both execute
        #       on the database? SQLite can only have one process write
        #       to the db. If this becomes an issue than we could also
        #       use an in-memory db (since that is a lot faster than
        #       disk). Otherwise we might have to use PostgreSQL.
        # TODO: first check the status and make sure it says PENDING or
        #       whatever. Because if is empty then this would write it
        #       and then get overwritten afterwards with "PENDING".

        data = post_data
        if data['status'] == 'STARTED':
            data['started_time'] = datetime.fromisoformat(data['started_time'])
        elif data['status'] in ['SUCCESS', 'FAILURE']:
            data['ended_time'] = datetime.fromisoformat(data['ended_time'])

        res = models.NonInteractiveRun.query.filter_by(
            experiment_uuid=experiment_uuid, run_uuid=run_uuid
        ).update(data)

        if res:
            db.session.commit()

        return {'message': 'Status was updated successfully'}, 200


@api.route(
    '/<string:experiment_uuid>/<string:run_uuid>/<string:step_uuid>',
    doc={
        'description': ('Set and get execution status of individual steps of '
                        'pipeline runs in an experiment.')
    }
)
@api.param('experiment_uuid', 'UUID of Experiment')
@api.param('run_uuid', 'UUID of Run')
@api.param('step_uuid', 'UUID of Step')
@api.response(404, 'Pipeline step not found')
class PipelineStepStatus(Resource):
    @api.doc('get_pipeline_run')
    @api.marshal_with(pipeline_run, code=200)
    def get(self, experiment_uuid, run_uuid, step_uuid):
        """Fetch a pipeline run of an experiment given their ids."""
        # TODO: Returns the status and logs. Of course logs are empty if
        #       the step is not executed yet.
        step = models.NonInteractiveRunStep.query.get_or_404(
            ident=(experiment_uuid, run_uuid, step_uuid),
            description='Scheduled run and step combination not found'
        )
        return step.__dict__

    @api.doc('set_pipeline_run_status')
    @api.expect(status_update)
    def put(self, experiment_uuid, run_uuid, step_uuid):
        """Set the status of a scheduleld run step."""
        post_data = request.get_json()

        # TODO: don't we want to do this async? Since otherwise the API
        #       call might be blocking another since they both execute
        #       on the database? SQLite can only have one process write
        #       to the db. If this becomes an issue than we could also
        #       use an in-memory db (since that is a lot faster than
        #       disk). Otherwise we might have to use PostgreSQL.
        # TODO: first check the status and make sure it says PENDING or
        #       whatever. Because if is empty then this would write it
        #       and then get overwritten afterwards with "PENDING".

        data = post_data
        if data['status'] == 'STARTED':
            data['started_time'] = datetime.fromisoformat(data['started_time'])
        elif data['status'] in ['SUCCESS', 'FAILURE']:
            data['ended_time'] = datetime.fromisoformat(data['ended_time'])

        res = models.NonInteractiveRunStep.query.filter_by(
            experiment_uuid=experiment_uuid,
            run_uuid=run_uuid,
            step_uuid=step_uuid,
        ).update(data)

        if res:
            db.session.commit()

        return {'message': 'Status was updated successfully'}, 200
