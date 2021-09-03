from flask.globals import current_app
from flask_restx import Namespace, Resource

from _orchest.internals import config as _config
from _orchest.internals.two_phase_executor import TwoPhaseExecutor, TwoPhaseFunction
from _orchest.internals.utils import docker_images_list_safe, docker_images_rm_safe
from app.apis.namespace_environment_builds import (
    DeleteProjectBuilds,
    DeleteProjectEnvironmentBuilds,
)
from app.apis.namespace_jobs import AbortJob
from app.apis.namespace_runs import AbortPipelineRun
from app.apis.namespace_sessions import StopInteractiveSession
from app.connections import db, docker_client
from app.core import docker_utils
from app.utils import (
    interactive_runs_using_environment,
    interactive_sessions_using_environment,
    is_environment_in_use,
    jobs_using_environment,
    register_schema,
)

api = Namespace("environment-images", description="Managing environment images")
api = register_schema(api)


@api.route(
    "/<string:project_uuid>/<string:environment_uuid>",
)
@api.param("project_uuid", "UUID of the project")
@api.param("environment_uuid", "UUID of the environment")
class EnvironmentImage(Resource):
    @api.doc("delete-environment-image")
    def delete(self, project_uuid, environment_uuid):
        """Removes an environment image given project and env uuids.

        Will stop any run or job making use of this environment.
        """
        try:
            with TwoPhaseExecutor(db.session) as tpe:
                DeleteImage(tpe).transaction(project_uuid, environment_uuid)

        except Exception as e:
            return {"message": str(e)}, 500

        return {"message": "Environment image was successfully deleted."}, 200


@api.route(
    "/in-use/<string:project_uuid>/<string:environment_uuid>",
)
@api.param("project_uuid", "UUID of the project")
@api.param("environment_uuid", "UUID of the environment")
class EnvironmentImageInUse(Resource):
    @api.doc("is-environment-in-use")
    def get(self, project_uuid, environment_uuid):
        in_use = is_environment_in_use(project_uuid, environment_uuid)
        return {"message": in_use, "in_use": in_use}, 200


@api.route(
    "/dangling/<string:project_uuid>/<string:environment_uuid>",
)
@api.param("project_uuid", "UUID of the project")
@api.param("environment_uuid", "UUID of the environment")
class ProjectEnvironmentDanglingImages(Resource):
    @api.doc("delete-project-environment-dangling-images")
    def delete(self, project_uuid, environment_uuid):
        """Removes dangling images related to a project and environment.
        Dangling images are images that have been left nameless and
        tag-less and which are not referenced by any run
        or job which are pending or running."""

        docker_utils.delete_project_environment_dangling_images(
            project_uuid, environment_uuid
        )
        return {"message": "Successfully removed dangling images."}, 200


class DeleteProjectEnvironmentImages(TwoPhaseFunction):
    def _transaction(self, project_uuid: str):
        # Cleanup references to the builds and dangling images of all
        # environments of this project.
        DeleteProjectBuilds(self.tpe).transaction(project_uuid)

        self.collateral_kwargs["project_uuid"] = project_uuid

    @classmethod
    def _background_collateral(cls, app, project_uuid):
        filters = {
            "label": [
                "_orchest_env_build_is_intermediate=0",
                f"_orchest_project_uuid={project_uuid}",
            ]
        }
        images_to_remove = docker_images_list_safe(docker_client, filters=filters)
        # Try with repeat because there might be a race condition where
        # aborted runs are still using the image or kernel containers
        # are still running.
        for img in images_to_remove:
            docker_images_rm_safe(docker_client, img.id)

        with app.app_context():
            docker_utils.delete_project_dangling_images(project_uuid)

    def _collateral(self, project_uuid: str):
        # Needs to happen in the background because session shutdown
        # happens in the background as well. The scheduler won't be
        # given control if an endpoint is, for example, sleeping.
        current_app.config["SCHEDULER"].add_job(
            DeleteProjectEnvironmentImages._background_collateral,
            args=[current_app._get_current_object(), project_uuid],
        )


class DeleteImage(TwoPhaseFunction):
    def _transaction(self, project_uuid: str, environment_uuid: str):
        # Stop all interactive sessions making use of the env by using
        # it as a service.
        int_sess = interactive_sessions_using_environment(
            project_uuid, environment_uuid
        )
        for sess in int_sess:
            StopInteractiveSession(self.tpe).transaction(
                sess.project_uuid, sess.pipeline_uuid
            )

        # Stop all interactive runs making use of the env.
        int_runs = interactive_runs_using_environment(project_uuid, environment_uuid)
        for run in int_runs:
            AbortPipelineRun(self.tpe).transaction(run.uuid)

        # Stop all jobs making use of the environment.
        jobs = jobs_using_environment(project_uuid, environment_uuid)
        for job in jobs:
            AbortJob(self.tpe).transaction(job.uuid)

        # Cleanup references to the builds and dangling images
        # of this environment.
        DeleteProjectEnvironmentBuilds(self.tpe).transaction(
            project_uuid, environment_uuid
        )

        self.collateral_kwargs["project_uuid"] = project_uuid
        self.collateral_kwargs["environment_uuid"] = environment_uuid

    @classmethod
    def _background_collateral(cls, app, project_uuid, environment_uuid):
        image_name = _config.ENVIRONMENT_IMAGE_NAME.format(
            project_uuid=project_uuid, environment_uuid=environment_uuid
        )
        # Try with repeat because there might be a race condition where
        # aborted runs are still using the image or kernel containers
        # are still running.
        docker_images_rm_safe(docker_client, image_name)

        with app.app_context():
            docker_utils.delete_project_environment_dangling_images(
                project_uuid, environment_uuid
            )

    def _collateral(self, project_uuid: str, environment_uuid: str):
        # Needs to happen in the background because session shutdown
        # happens in the background as well. The scheduler won't be
        # given control if an endpoint is, for example, sleeping.
        current_app.config["SCHEDULER"].add_job(
            DeleteImage._background_collateral,
            args=[current_app._get_current_object(), project_uuid, environment_uuid],
        )
