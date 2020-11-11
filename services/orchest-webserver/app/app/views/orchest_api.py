import requests
import logging
from app.models import PipelineRun
from flask import render_template, request, jsonify
from app.utils import (
    project_uuid_to_path,
    get_project_directory,
    pipeline_uuid_to_path,
    get_environments,
)


def api_proxy_environment_builds(environment_build_requests, orchest_api_address):
    """
    environment_build_requests: List[] of EnvironmentBuildRequest
    EnvironmentBuildRequest = {
        project_uuid:str
        environment_uuid:str
        project_path:str
    }
    """

    json_obj = {"environment_build_requests": environment_build_requests}

    resp = requests.post(
        "http://" + orchest_api_address + "/api/environment-builds/",
        json=json_obj,
        stream=True,
    )

    return resp


def register_orchest_api_views(app, db):
    @app.route("/catch/api-proxy/api/checks/gate/<project_uuid>", methods=["POST"])
    def catch_api_proxy_checks_gate(project_uuid):

        environment_uuids = [
            environment.uuid for environment in get_environments(project_uuid)
        ]

        resp = requests.post(
            "http://"
            + app.config["ORCHEST_API_ADDRESS"]
            + "/api/checks/gate/%s" % project_uuid,
            json={"type": "shallow", "environment_uuids": environment_uuids},
            stream=True,
        )
        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route(
        "/catch/api-proxy/api/environment-builds/most-recent/<project_uuid>/<environment_uuid>",
        methods=["GET"],
    )
    def catch_api_proxy_environment_build_most_recent(project_uuid, environment_uuid):

        resp = requests.get(
            "http://"
            + app.config["ORCHEST_API_ADDRESS"]
            + "/api/environment-builds/most-recent/%s/%s"
            % (project_uuid, environment_uuid),
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route(
        "/catch/api-proxy/api/environment-builds/<environment_build_uuid>",
        methods=["DELETE"],
    )
    def catch_api_proxy_environment_build_delete(environment_build_uuid):

        resp = requests.delete(
            "http://"
            + app.config["ORCHEST_API_ADDRESS"]
            + "/api/environment-builds/%s" % (environment_build_uuid),
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route(
        "/catch/api-proxy/api/environment-builds/most-recent/<project_uuid>",
        methods=["GET"],
    )
    def catch_api_proxy_environment_builds_most_recent(project_uuid):

        resp = requests.get(
            "http://"
            + app.config["ORCHEST_API_ADDRESS"]
            + "/api/environment-builds/most-recent/%s" % project_uuid,
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route("/catch/api-proxy/api/environment-builds", methods=["POST"])
    def catch_api_proxy_environment_builds():

        environment_build_requests = request.json["environment_build_requests"]

        for environment_build_request in environment_build_requests:
            environment_build_request["project_path"] = project_uuid_to_path(
                environment_build_request["project_uuid"]
            )

        resp = api_proxy_environment_builds(
            environment_build_requests, app.config["ORCHEST_API_ADDRESS"]
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route("/catch/api-proxy/api/runs/", methods=["POST"])
    def catch_api_proxy_runs():

        json_obj = request.json

        # add image mapping
        # TODO: replace with dynamic mapping instead of hardcoded
        json_obj["run_config"] = {
            "project_dir": get_project_directory(
                json_obj["project_uuid"], host_path=True
            ),
            "pipeline_path": pipeline_uuid_to_path(
                json_obj["pipeline_description"]["uuid"], json_obj["project_uuid"]
            ),
        }

        resp = requests.post(
            "http://" + app.config["ORCHEST_API_ADDRESS"] + "/api/runs/",
            json=json_obj,
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route("/catch/api-proxy/api/sessions/", methods=["POST"])
    def catch_api_proxy_sessions():

        json_obj = request.json

        json_obj["project_dir"] = get_project_directory(
            json_obj["project_uuid"], host_path=True
        )

        json_obj["pipeline_path"] = pipeline_uuid_to_path(
            json_obj["pipeline_uuid"],
            json_obj["project_uuid"],
        )

        json_obj["host_userdir"] = app.config["HOST_USER_DIR"]

        resp = requests.post(
            "http://" + app.config["ORCHEST_API_ADDRESS"] + "/api/sessions/",
            json=json_obj,
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route("/catch/api-proxy/api/experiments/", methods=["POST"])
    def catch_api_proxy_experiments_post():

        json_obj = request.json

        json_obj["pipeline_run_spec"]["run_config"] = {
            "host_user_dir": app.config["HOST_USER_DIR"],
            "project_dir": get_project_directory(
                json_obj["project_uuid"], host_path=True
            ),
            "pipeline_path": pipeline_uuid_to_path(
                json_obj["pipeline_uuid"],
                json_obj["project_uuid"],
            ),
        }

        resp = requests.post(
            "http://" + app.config["ORCHEST_API_ADDRESS"] + "/api/experiments/",
            json=json_obj,
            stream=True,
        )

        return resp.raw.read(), resp.status_code, resp.headers.items()

    @app.route("/catch/api-proxy/api/experiments/<experiment_uuid>", methods=["GET"])
    def catch_api_proxy_experiments_get(experiment_uuid):

        resp = requests.get(
            "http://"
            + app.config["ORCHEST_API_ADDRESS"]
            + "/api/experiments/"
            + experiment_uuid,
            stream=True,
        )

        # get PipelineRuns to augment response
        pipeline_runs = PipelineRun.query.filter(
            PipelineRun.experiment == experiment_uuid
        ).all()

        pipeline_runs_dict = {}

        for pipeline_run in pipeline_runs:
            pipeline_runs_dict[pipeline_run.id] = pipeline_run

        json_return = resp.json()
        json_return["pipeline_runs"] = sorted(
            json_return["pipeline_runs"], key=lambda x: x["pipeline_run_id"]
        )

        # augment response with parameter values that are stored on the webserver
        if resp.status_code == 200:

            try:
                logging.info(json_return)

                for run in json_return["pipeline_runs"]:
                    run["parameters"] = pipeline_runs_dict[
                        run["pipeline_run_id"]
                    ].parameter_json

                return jsonify(json_return)
            except Exception as e:
                return str(e), 500

        else:
            return resp.raw.read(), resp.status_code
