import uuid
from datetime import datetime
from typing import Optional

from celery.contrib.abortable import AbortableAsyncResult
from flask import abort, current_app, request
from flask_restx import Namespace, Resource
from sqlalchemy import desc, func, or_

import app.models as models
from _orchest.internals.two_phase_executor import TwoPhaseExecutor, TwoPhaseFunction
from _orchest.internals.utils import docker_images_list_safe, docker_images_rm_safe
from app import schema
from app.celery_app import make_celery
from app.connections import db, docker_client
from app.utils import register_schema, update_status_db

api = Namespace("environment-builds", description="Managing environment builds")
api = register_schema(api)


@api.route("/")
class EnvironmentBuildList(Resource):
    @api.doc("get_environment_builds")
    @api.marshal_with(schema.environment_builds)
    def get(self):
        """Fetches all environment builds (past and present).

        The environment builds are either PENDING, STARTED, SUCCESS,
        FAILURE, ABORTED.

        """
        environment_builds = models.EnvironmentBuild.query.all()
        if not environment_builds:
            environment_builds = []

        return (
            {"environment_builds": [envb.as_dict() for envb in environment_builds]},
            200,
        )

    @api.doc("start_environment_builds")
    @api.expect(schema.environment_build_requests)
    @api.marshal_with(
        schema.environment_builds_requests_result,
        code=201,
        description="Queued environment builds",
    )
    def post(self):
        """Queues a list of environment builds.

        Only unique requests are considered, meaning that a request
        containing duplicate environment_build_requests will produce an
        environment build only for each unique
        environment_build_request. Note that requesting an
        environment_build for an environment (identified by
        project_uuid, environment_uuid, project_path) will REVOKE/ABORT
        any other active (queued or actually started) environment build
        for that environment.  This implies that only an environment
        build can be active (queued or actually started) for a given
        environment.
        """

        # keep only unique requests
        post_data = request.get_json()
        builds_requests = post_data["environment_build_requests"]
        builds_requests = set(
            [
                (req["project_uuid"], req["environment_uuid"], req["project_path"])
                for req in builds_requests
            ]
        )
        builds_requests = [
            {
                "project_uuid": req[0],
                "environment_uuid": req[1],
                "project_path": req[2],
            }
            for req in builds_requests
        ]

        defined_builds = []
        failed_requests = []
        # Start a celery task for each unique environment build request.
        for build_request in builds_requests:
            try:
                with TwoPhaseExecutor(db.session) as tpe:
                    defined_builds.append(
                        CreateEnvironmentBuild(tpe).transaction(build_request)
                    )
            except Exception:
                failed_requests.append(build_request)

        return_data = {"environment_builds": defined_builds}
        return_code = 200

        if failed_requests:
            return_data["failed_requests"] = failed_requests
            return_code = 500

        return return_data, return_code


@api.route(
    "/<string:environment_build_uuid>",
)
@api.param("environment_build_uuid", "UUID of the EnvironmentBuild")
@api.response(404, "Environment build not found")
class EnvironmentBuild(Resource):
    @api.doc("get_environment_build")
    @api.marshal_with(schema.environment_build, code=200)
    def get(self, environment_build_uuid):
        """Fetch an environment build given its uuid."""
        env_build = models.EnvironmentBuild.query.filter_by(
            uuid=environment_build_uuid
        ).one_or_none()
        if env_build is not None:
            return env_build.as_dict()
        abort(404, "EnvironmentBuild not found.")

    @api.doc("set_environment_build_status")
    @api.expect(schema.status_update)
    def put(self, environment_build_uuid):
        """Set the status of a environment build."""
        status_update = request.get_json()

        filter_by = {
            "uuid": environment_build_uuid,
        }
        try:
            update_status_db(
                status_update,
                model=models.EnvironmentBuild,
                filter_by=filter_by,
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            return {"message": "Failed update operation."}, 500

        return {"message": "Status was updated successfully."}, 200

    @api.doc("delete_environment_build")
    @api.response(200, "Environment build cancelled or stopped ")
    def delete(self, environment_build_uuid):
        """Stops an environment build given its UUID.

        However, it will not delete any corresponding database entries,
        it will update the status of corresponding objects to ABORTED.
        """
        try:
            with TwoPhaseExecutor(db.session) as tpe:
                could_abort = AbortEnvironmentBuild(tpe).transaction(
                    environment_build_uuid
                )
        except Exception as e:
            return {"message": str(e)}, 500

        if could_abort:
            return {"message": "Environment build termination was successfull."}, 200
        else:
            return {
                "message": "Environment build does not exist or is not running."
            }, 400


@api.route(
    "/most-recent/<string:project_uuid>",
)
@api.param(
    "project_uuid",
    "UUID of the project for which environment builds should be collected",
)
class ProjectMostRecentBuildsList(Resource):
    @api.doc("get_project_most_recent_environment_builds")
    @api.marshal_with(schema.environment_builds, code=200)
    def get(self, project_uuid):
        """Get the most recent build for each environment of a project.

        Only environments for which builds have already been requested
        are considered.  Meaning that environments that are part of a
        project but have never been built won't be part of results.

        """

        # Filter by project uuid. Use a window function to get the most
        # recently requested build for each environment return.
        rank = (
            func.rank()
            .over(partition_by="environment_uuid", order_by=desc("requested_time"))
            .label("rank")
        )
        query = db.session.query(models.EnvironmentBuild)
        query = query.filter_by(project_uuid=project_uuid)
        query = query.add_column(rank)
        # Note: this works because rank is of type Label and rank == 1
        # will evaluate to sqlalchemy.sql.elements.BinaryExpression
        # since the equality operator is overloaded.
        query = query.from_self().filter(rank == 1)
        query = query.with_entities(models.EnvironmentBuild)
        env_builds = query.all()

        return {"environment_builds": [build.as_dict() for build in env_builds]}


@api.route("/most-recent/<string:project_uuid>/<string:environment_uuid>")
@api.param("project_uuid", "UUID of the project.")
@api.param("environment_uuid", "UUID of the environment.")
class ProjectEnvironmentMostRecentBuild(Resource):
    @api.doc("get_most_recent_build_by_proj_env")
    @api.marshal_with(schema.environment_builds, code=200)
    def get(self, project_uuid, environment_uuid):
        """Get the most recent build for a project and environment pair.

        Only environments for which builds have already been requested
        are considered.
        """

        environment_builds = []

        recent = (
            db.session.query(models.EnvironmentBuild)
            .filter_by(project_uuid=project_uuid, environment_uuid=environment_uuid)
            .order_by(desc(models.EnvironmentBuild.requested_time))
            .first()
        )
        if recent:
            environment_builds.append(recent.as_dict())

        return {"environment_builds": environment_builds}


class CreateEnvironmentBuild(TwoPhaseFunction):
    def _transaction(self, build_request):

        # Abort any environment build of this environment that is
        # already running, given by the status of PENDING/STARTED.
        already_running_builds = models.EnvironmentBuild.query.filter(
            models.EnvironmentBuild.project_uuid == build_request["project_uuid"],
            models.EnvironmentBuild.environment_uuid
            == build_request["environment_uuid"],
            models.EnvironmentBuild.project_path == build_request["project_path"],
            or_(
                models.EnvironmentBuild.status == "PENDING",
                models.EnvironmentBuild.status == "STARTED",
            ),
        ).all()

        for build in already_running_builds:
            AbortEnvironmentBuild(self.tpe).transaction(build.uuid)

        # We specify the task id beforehand so that we can commit to the
        # db before actually launching the task, since the task might
        # make some calls to the orchest-api referring to itself (e.g.
        # a status update), and thus expecting to find itself in the db.
        # This way we avoid race conditions.
        task_id = str(uuid.uuid4())

        # TODO: verify if forget has the same effect of
        # ignore_result=True because ignore_result cannot be used with
        # abortable tasks.
        # https://stackoverflow.com/questions/9034091/how-to-check-task-status-in-celery
        # task.forget()

        environment_build = {
            "uuid": task_id,
            "project_uuid": build_request["project_uuid"],
            "environment_uuid": build_request["environment_uuid"],
            "project_path": build_request["project_path"],
            "requested_time": datetime.fromisoformat(datetime.utcnow().isoformat()),
            "status": "PENDING",
        }
        db.session.add(models.EnvironmentBuild(**environment_build))

        self.collateral_kwargs["task_id"] = task_id
        self.collateral_kwargs["project_uuid"] = build_request["project_uuid"]
        self.collateral_kwargs["environment_uuid"] = build_request["environment_uuid"]
        self.collateral_kwargs["project_path"] = build_request["project_path"]
        return environment_build

    def _collateral(
        self, task_id: str, project_uuid: str, environment_uuid: str, project_path: str
    ):
        celery = make_celery(current_app)
        celery_job_kwargs = {
            "project_uuid": project_uuid,
            "environment_uuid": environment_uuid,
            "project_path": project_path,
        }

        celery.send_task(
            "app.core.tasks.build_environment",
            kwargs=celery_job_kwargs,
            task_id=task_id,
        )

    def _revert(self):
        models.EnvironmentBuild.query.filter_by(
            uuid=self.collateral_kwargs["task_id"]
        ).update({"status": "FAILURE"})
        db.session.commit()


class AbortEnvironmentBuild(TwoPhaseFunction):
    def _transaction(self, environment_build_uuid: str):

        filter_by = {
            "uuid": environment_build_uuid,
        }
        status_update = {"status": "ABORTED"}
        # Will return true if any row is affected, meaning that the
        # environment build was actually PENDING or STARTED.
        abortable = update_status_db(
            status_update,
            model=models.EnvironmentBuild,
            filter_by=filter_by,
        )

        self.collateral_kwargs["environment_build_uuid"] = (
            environment_build_uuid if abortable else None
        )
        return abortable

    def _collateral(self, environment_build_uuid: Optional[str]):

        if not environment_build_uuid:
            return

        celery_app = make_celery(current_app)
        # Make use of both constructs (revoke, abort) so we cover both a
        # task that is pending and a task which is running.
        celery_app.control.revoke(environment_build_uuid, timeout=1.0)
        res = AbortableAsyncResult(environment_build_uuid, app=celery_app)
        # It is responsibility of the task to terminate by reading it's
        # aborted status.
        res.abort()

        # Necessary to avoid a race condition where a task is aborted
        # but the image has already been built and the worker won't do
        # any more "isAborted" checks.
        filters = {
            "label": [
                f"_orchest_env_build_task_uuid={environment_build_uuid}",
            ]
        }
        images_to_remove = docker_images_list_safe(docker_client, filters=filters)
        for img in images_to_remove:
            docker_images_rm_safe(docker_client, img.id)


class DeleteProjectEnvironmentBuilds(TwoPhaseFunction):
    def _transaction(self, project_uuid: str, environment_uuid: str):
        # Order by request time so that the first build might be related
        # be related to a PENDING or STARTED build, all others are
        # surely not PENDING or STARTED.
        env_builds = (
            models.EnvironmentBuild.query.filter_by(
                project_uuid=project_uuid, environment_uuid=environment_uuid
            )
            .order_by(desc(models.EnvironmentBuild.requested_time))
            .all()
        )

        if len(env_builds) > 0 and env_builds[0].status in ["PENDING", "STARTED"]:
            AbortEnvironmentBuild(self.tpe).transaction(env_builds[0].uuid)

        for build in env_builds:
            db.session.delete(build)

    def _collateral(self):
        pass


class DeleteProjectBuilds(TwoPhaseFunction):
    def _transaction(self, project_uuid: str):
        builds = (
            models.EnvironmentBuild.query.filter_by(project_uuid=project_uuid)
            .with_entities(
                models.EnvironmentBuild.project_uuid,
                models.EnvironmentBuild.environment_uuid,
            )
            .distinct()
            .all()
        )

        for build in builds:
            DeleteProjectEnvironmentBuilds(self.tpe).transaction(
                build.project_uuid, build.environment_uuid
            )

    def _collateral(self):
        pass
