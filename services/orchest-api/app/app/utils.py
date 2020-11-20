from datetime import datetime
from typing import Dict, Set
import requests
import logging

from docker import errors
from flask_restplus import Model, Namespace

from app import schema
from app.connections import db, docker_client
import app.models as models
from _orchest.internals import config as _config


def register_schema(api: Namespace) -> Namespace:
    all_models = [
        getattr(schema, attr)
        for attr in dir(schema)
        if isinstance(getattr(schema, attr), Model)
    ]

    # TODO: only a subset of all models should be registered.
    for model in all_models:
        api.add_model(model.name, model)

    return api


def shutdown_jupyter_server(url: str) -> bool:
    """Shuts down the Jupyter server via an authenticated POST request.

    Sends an authenticated DELETE request to:
        "url"/api/kernels/<kernel.id>
    for every running kernel. And then shuts down the Jupyter server
    itself via an authenticated POST request to:
        "url"/api/shutdown

    Args:
        connection_file: path to the connection_file that contains the
            server information needed to connect to the Jupyter server.
        url: the url at which the Jupyter server is running.

    Returns:
        False if no Jupyter server is running. True otherwise.
    """

    logging.info("Shutting down Jupyter Server at url: %s" % url)

    # Shutdown the server, such that it also shuts down all related
    # kernels.
    # NOTE: Do not use /api/shutdown to gracefully shut down all kernels
    # as it is non-blocking, causing container based kernels to persist!
    r = requests.get(f"{url}api/kernels")

    kernels_json = r.json()

    # In case there are connection issue with the Gateway, then the
    # "kernels_json" will be a dictionary:
    # {'message': "Connection refused from Gateway server url, ...}
    # Thus we first check whether we can indeed start shutting down
    # kernels.
    if isinstance(kernels_json, list):
        for kernel in kernels_json:
            requests.delete(f'{url}api/kernels/{kernel.get("id")}')

    # Now that all kernels all shut down, also shut down the Jupyter
    # server itself.
    r = requests.post(f"{url}api/shutdown")

    return True


def update_status_db(
    status_update: Dict[str, str], model: Model, filter_by: Dict[str, str]
) -> None:
    """Updates the status attribute of particular entry in the database.

    Args:
        status_update: The new status {'status': 'STARTED'}.
        model: Database model to update the status of.
        filter_by: The filter to query the exact resource for which to
            update its status.

    """
    data = status_update

    if data["status"] == "STARTED":
        data["started_time"] = datetime.fromisoformat(data["started_time"])
    elif data["status"] in ["SUCCESS", "FAILURE"]:
        data["finished_time"] = datetime.fromisoformat(data["finished_time"])

    res = model.query.filter_by(**filter_by).update(data)

    if res:
        db.session.commit()

    return


def get_environment_image_docker_id(name_or_id: str):
    try:
        return docker_client.images.get(name_or_id).id
    except errors.ImageNotFound:
        return None


def get_env_uuids_to_docker_id_mappings(
    project_uuid: str, env_uuids: Set[str]
) -> Dict[str, str]:
    """Map each environment uuid to its current image docker id.

    Args:
        project_uuid: UUID of the project to which the environments
         belong
        env_uuids: Set of environment uuids.

    Returns:
        Dict[env_uuid] = docker_id

    """
    env_uuid_docker_id_mappings = {
        env_uuid: get_environment_image_docker_id(
            _config.ENVIRONMENT_IMAGE_NAME.format(
                project_uuid=project_uuid, environment_uuid=env_uuid
            )
        )
        for env_uuid in env_uuids
    }
    missing_images = [
        str(errors.ImageNotFound(f"{env_uuid} has no docker image"))
        for env_uuid, docker_id in env_uuid_docker_id_mappings.items()
        if docker_id is None
    ]
    if len(missing_images) > 0:
        raise errors.ImageNotFound("\n".join(missing_images))
    return env_uuid_docker_id_mappings


def lock_environment_images_for_run(
    run_id: str, project_uuid: str, environment_uuids: Set[str], is_interactive: bool
) -> Dict[str, str]:
    """Retrieve the docker ids to use for a pipeline run.

    Locks a set of environment images by making it so that they will
    not be deleted by the attempt cleanup that follows an environment
    build.
    This is done by adding some entries to the db that will signal
    the fact that the image will be used by a run, as long as the
    run is PENDING or STARTED.
    In order to avoid a race condition that happens between
    reading the docker ids of the used environment and actually
    writing to db, some logic needs to take place, such logic constitutes
    the bulk of this function.
    As a collateral effect, new entries for interactive or non
    interactive image mappings will be added, which is at the same
    time the mechanism through which we "lock" the images, or, protect
    them from deletion as long as they are needed.
    About the race condition:
        between the read of the images docker ids and the commit
        to the db of the mappings a new environment could have been
        built, an image could have become nameless and be
        subsequently removed because the image mappings where not
        in the db yet, and we would end up with  mappings that are
        pointing to an image that does not exist.
        If we would only check for the existence of the img we could
        still be in a race condition, so we must act on the image
        becoming nameless, not deleted.

    Args:
        run_id:
        project_uuid:
        environment_uuids:
        is_interactive: True if this is an interactive run, false
         otherwise. Simply affects to what table new records are written to,
         i.e. interactive or non interactive.

    Returns:
        A dictionary mapping environment uuids to the docker id
        of the image, so that the run steps can make use of those
        images knowingly that the images won't be deleted, even
        if they become outdated.

    """
    model = (
        models.InteractiveRunImageMapping
        if is_interactive
        else models.NonInteractiveRunImageMapping
    )

    # read the current docker image ids of each env
    env_uuid_docker_id_mappings = get_env_uuids_to_docker_id_mappings(
        project_uuid, environment_uuids
    )

    # write to the db the image_uuids and docker ids the run uses
    # this is our first lock attempt
    run_image_mappings = [
        model(
            **{
                "run_uuid": run_id,
                "orchest_environment_uuid": env_uuid,
                "docker_img_id": docker_id,
            }
        )
        for env_uuid, docker_id in env_uuid_docker_id_mappings.items()
    ]
    db.session.bulk_save_objects(run_image_mappings)
    db.session.commit()

    # if the mappings have changed it means that at least 1 image
    # that we are using has become nameless and it is outdated, and
    # might be deleted if we did not lock in time, i.e. if we got
    # on the base side of the race condition
    env_uuid_docker_id_mappings2 = get_env_uuids_to_docker_id_mappings(
        project_uuid, environment_uuids
    )
    while set(env_uuid_docker_id_mappings.values()) != set(
        env_uuid_docker_id_mappings2.values()
    ):
        # get which environment images have been updated
        # between the moment we read the docker id and the
        # commit to db, this is a lock attempt
        mappings_to_update = set(env_uuid_docker_id_mappings2.items()) - set(
            env_uuid_docker_id_mappings.items()
        )
        for env_uuid, docker_id in mappings_to_update:
            model.query.filter(
                # same task
                model.run_uuid == run_id,
                # same environment
                model.orchest_environment_uuid == env_uuid
                # update docker id to which the run will point to
            ).update({"docker_img_id": docker_id})
        db.session.commit()

        env_uuid_docker_id_mappings = env_uuid_docker_id_mappings2

        # the next time we check for equality,
        # if they are equal that means that we know that we are
        # pointing to images that won't be deleted because the
        # run is already in the db as PENDING
        env_uuid_docker_id_mappings2 = get_env_uuids_to_docker_id_mappings(
            project_uuid, environment_uuids
        )
    return env_uuid_docker_id_mappings


def remove_if_dangling(img):
    """Remove an image if its dangling.

    A dangling image is an image that is nameless and tag-less,
    and for which no runs exist that are PENDING or STARTED and that
    are going to use this image in one of their steps.

    Args:
        img:

    Returns:

    """
    # nameless image
    if len(img.attrs["RepoTags"]) == 0:
        int_runs = models.InteractiveRun.query.filter(
            models.InteractiveRun.image_mappings.any(docker_img_id=img.id),
            models.InteractiveRun.status.in_(["PENDING", "STARTED"]),
        ).all()
        non_int_runs = models.NonInteractiveRun.query.filter(
            models.NonInteractiveRun.image_mappings.any(docker_img_id=img.id),
            models.NonInteractiveRun.status.in_(["PENDING", "STARTED"]),
        ).all()

        # the image will not be used anymore, since no run that is
        # PENDING or STARTED is pointing to it and the image is nameless
        # meaning that all future runs using the same environment will
        # use another image
        if len(int_runs) == 0 and len(non_int_runs) == 0:
            # use try-catch block because the image might have been
            # cleaned up by a concurrent request
            try:
                docker_client.images.remove(img.id)
            except errors.ImageNotFound:
                return False
    return True
