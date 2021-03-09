import uuid
from datetime import datetime
from typing import Optional

from celery.contrib.abortable import AbortableAsyncResult
from flask import abort, current_app, request
from flask_restx import Namespace, Resource, marshal
from sqlalchemy import or_

import app.models as models
from _orchest.internals.two_phase_executor import TwoPhaseExecutor, TwoPhaseFunction
from app import schema
from app.celery_app import make_celery
from app.connections import db
from app.errors import SessionInProgressException
from app.utils import register_schema, update_status_db

api = Namespace("jupyter-builds", description="Build Jupyter server image")
api = register_schema(api)


@api.route("/")
class JupyterBuildList(Resource):
    @api.doc("get_jupyter_builds")
    @api.marshal_with(schema.jupyter_builds)
    def get(self):
        """Fetches all jupyter builds (past and present).

        The jupyter builds are either PENDING, STARTED, SUCCESS,
        FAILURE, ABORTED.

        """
        jupyter_builds = models.JupyterBuild.query.all()

        return (
            {
                "jupyter_builds": [
                    jupyter_build.as_dict() for jupyter_build in jupyter_builds
                ]
            },
            200,
        )

    @api.doc("start_jupyter_build")
    def post(self):
        """Queues a Jupyter build."""
        try:
            with TwoPhaseExecutor(db.session) as tpe:
                jupyter_build = CreateJupyterBuild(tpe).transaction()
        except SessionInProgressException:
            return {"message": "SessionInProgressException"}, 500
        except Exception:
            jupyter_build = None

        if jupyter_build is not None:
            return_data = {"jupyter_build": jupyter_build}
            return_code = 200
        else:
            return_data = {}
            return_code = 500

        return marshal(return_data, schema.jupyter_build_request_result), return_code


@api.route(
    "/<string:jupyter_build_uuid>",
)
@api.param("jupyter_build_uuid", "UUID of the JupyterBuild")
@api.response(404, "Jupyter build not found")
class JupyterBuild(Resource):
    @api.doc("get_jupyter_build")
    @api.marshal_with(schema.jupyter_build, code=200)
    def get(self, jupyter_build_uuid):
        """Fetch a Jupyter build given its uuid."""
        jupyter_build = models.JupyterBuild.query.filter_by(
            uuid=jupyter_build_uuid
        ).one_or_none()
        if jupyter_build is not None:
            return jupyter_build.as_dict()
        abort(404, "JupyterBuild not found.")

    @api.doc("set_jupyter_build_status")
    @api.expect(schema.status_update)
    def put(self, jupyter_build_uuid):
        """Set the status of a jupyter build."""
        status_update = request.get_json()

        filter_by = {
            "uuid": jupyter_build_uuid,
        }
        try:
            update_status_db(
                status_update,
                model=models.JupyterBuild,
                filter_by=filter_by,
            )
            db.session.commit()
        except Exception:
            db.session.rollback()
            return {"message": "Failed update operation."}, 500

        return {"message": "Status was updated successfully."}, 200

    @api.doc("delete_jupyter_build")
    @api.response(200, "Jupyter build cancelled or stopped ")
    def delete(self, jupyter_build_uuid):
        """Stops a Jupyter build given its UUID.

        However, it will not delete any corresponding database entries,
        it will update the status of corresponding objects to ABORTED.
        """
        try:
            with TwoPhaseExecutor(db.session) as tpe:
                could_abort = AbortJupyterBuild(tpe).transaction(jupyter_build_uuid)
        except Exception as e:
            return {"message": str(e)}, 500

        if could_abort:
            return {"message": "Jupyter build termination was successfull."}, 200
        else:
            return {"message": "Jupyter build does not exist or is not running."}, 400


@api.route(
    "/most-recent/",
)
class MostRecentJupyterBuild(Resource):
    @api.doc("get_project_most_recent_jupyter_build")
    @api.marshal_with(schema.jupyter_builds, code=200)
    def get(self):
        """Get the most recent Jupyter build."""

        # Filter by project uuid. Use a window function to get the most
        # recently requested build for each environment return.
        jupyter_builds = (
            models.JupyterBuild.query.order_by(
                models.JupyterBuild.requested_time.desc()
            )
            .limit(1)
            .all()
        )

        return {"jupyter_builds": [build.as_dict() for build in jupyter_builds]}


class CreateJupyterBuild(TwoPhaseFunction):
    def _transaction(self):
        # Check if there are any active sessions
        active_session_count = models.InteractiveSession.query.filter(
            or_(
                models.InteractiveSession.status == "LAUNCHING",
                models.InteractiveSession.status == "RUNNING",
                models.InteractiveSession.status == "STOPPING",
            )
        ).count()

        if active_session_count > 0:
            raise SessionInProgressException()

        # Abort any Jupyter build that is
        # already running, given by the status of PENDING/STARTED.
        already_running_builds = models.JupyterBuild.query.filter(
            or_(
                models.JupyterBuild.status == "PENDING",
                models.JupyterBuild.status == "STARTED",
            ),
        ).all()

        for build in already_running_builds:
            AbortJupyterBuild(self.tpe).transaction(build.uuid)

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

        jupyter_build = {
            "uuid": task_id,
            "requested_time": datetime.fromisoformat(datetime.utcnow().isoformat()),
            "status": "PENDING",
        }
        db.session.add(models.JupyterBuild(**jupyter_build))

        self.collateral_kwargs["task_id"] = task_id
        return jupyter_build

    def _collateral(self, task_id: str):
        celery = make_celery(current_app)

        celery.send_task(
            "app.core.tasks.build_jupyter",
            task_id=task_id,
        )

    def _revert(self):
        models.JupyterBuild.query.filter_by(
            uuid=self.collateral_kwargs["task_id"]
        ).update({"status": "FAILURE"})
        db.session.commit()


class AbortJupyterBuild(TwoPhaseFunction):
    def _transaction(self, jupyter_build_uuid: str):

        filter_by = {
            "uuid": jupyter_build_uuid,
        }
        status_update = {"status": "ABORTED"}
        # Will return true if any row is affected, meaning that the
        # jupyter build was actually PENDING or STARTED.
        abortable = update_status_db(
            status_update,
            model=models.JupyterBuild,
            filter_by=filter_by,
        )

        self.collateral_kwargs["jupyter_build_uuid"] = (
            jupyter_build_uuid if abortable else None
        )
        return abortable

    def _collateral(self, jupyter_build_uuid: Optional[str]):

        if not jupyter_build_uuid:
            return

        celery_app = make_celery(current_app)
        # Make use of both constructs (revoke, abort) so we cover both a
        # task that is pending and a task which is running.
        celery_app.control.revoke(jupyter_build_uuid, timeout=1.0)
        res = AbortableAsyncResult(jupyter_build_uuid, app=celery_app)
        # It is responsibility of the task to terminate by reading it's
        # aborted status.
        res.abort()
