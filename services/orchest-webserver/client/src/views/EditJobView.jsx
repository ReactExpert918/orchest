import React, { Fragment } from "react";
import _ from "lodash";
import {
  MDCTabBarReact,
  MDCButtonReact,
  MDCLinearProgressReact,
  MDCRadioReact,
} from "@orchest/lib-mdc";
import {
  makeRequest,
  makeCancelable,
  PromiseManager,
  RefManager,
} from "@orchest/lib-utils";

import {
  checkGate,
  getPipelineJSONEndpoint,
  envVariablesArrayToDict,
  envVariablesDictToArray,
} from "@/utils/webserver-utils";
import { OrchestContext } from "@/hooks/orchest";
import { Layout } from "@/components/Layout";
import { DescriptionList } from "@/components/DescriptionList";
import ParameterEditor from "@/components/ParameterEditor";
import CronScheduleInput from "@/components/CronScheduleInput";
import DateTimeInput from "@/components/DateTimeInput";
import SearchableTable from "@/components/SearchableTable";
import ParamTree from "@/components/ParamTree";
import EnvVarList from "@/components/EnvVarList";
import JobView from "@/views/JobView";
import JobsView from "@/views/JobsView";

class EditJobView extends React.Component {
  static contextType = OrchestContext;

  constructor(props, context) {
    super(props, context);

    this.state = {
      selectedTabIndex: 0,
      generatedPipelineRuns: [],
      generatedPipelineRunRows: [],
      selectedIndices: [],
      scheduleOption: "now",
      runJobLoading: false,
      pipeline: undefined,
      cronString: undefined,
      strategyJSON: {},
      unsavedChanges: false,
    };

    this.promiseManager = new PromiseManager();
    this.refManager = new RefManager();
  }

  componentWillUnmount() {
    this.promiseManager.cancelCancelablePromises();
  }

  fetchJob() {
    let fetchJobPromise = makeCancelable(
      makeRequest(
        "GET",
        `/catch/api-proxy/api/jobs/${this.props.queryArgs.job_uuid}`
      ),
      this.promiseManager
    );

    fetchJobPromise.promise.then((response) => {
      try {
        let job = JSON.parse(response);

        this.state.job = job;

        this.setState({
          job: job,
          cronString: job.schedule === null ? "* * * * *" : job.schedule,
          scheduleOption: job.schedule === null ? "now" : "cron",
          envVariables: envVariablesDictToArray(job["env_variables"]),
        });

        if (job.status !== "DRAFT") {
          this.setState({
            strategyJSON: job.strategy_json,
          });
        }

        this.fetchPipeline();
      } catch (error) {
        console.error(error);
      }
    });
  }

  fetchPipeline() {
    let fetchPipelinePromise = makeCancelable(
      makeRequest(
        "GET",
        getPipelineJSONEndpoint(
          this.state.job.pipeline_uuid,
          this.state.job.project_uuid,
          this.state.job.uuid
        )
      ),
      this.promiseManager
    );

    fetchPipelinePromise.promise.then((response) => {
      let result = JSON.parse(response);
      if (result.success) {
        let pipeline = JSON.parse(result["pipeline_json"]);

        let strategyJSON;

        if (this.state.job.status === "DRAFT") {
          strategyJSON = this.generateStrategyJson(pipeline);
        } else {
          strategyJSON = this.state.job.strategy_json;
          
        }

        let [
          generatedPipelineRuns,
          generatedPipelineRunRows,
          selectedIndices,
        ] = this.generateWithStrategy(strategyJSON);


        if (this.state.job.status !== "DRAFT") {
          // Determine selection based on strategyJSON
          selectedIndices = this.parseParameters(this.state.job.parameters, generatedPipelineRuns);
        }

        this.setState({
          pipeline,
          strategyJSON,
          generatedPipelineRuns,
          generatedPipelineRunRows,
          selectedIndices,
        });

        

      } else {
        console.warn("Could not load pipeline.json");
        console.log(result);
      }
    });
  }

  findParameterization(parameterization, parameters){
    let JSONstring = JSON.stringify(parameterization);
    for(let x = 0; x < parameters.length; x++){
      if(JSON.stringify(parameters[x]) == JSONstring){
        return x;
      }
    }
    return -1;
  }

  parseParameters(parameters, generatedPipelineRuns) {
    let _parameters = _.cloneDeep(parameters);
    let selectedIndices = Array(generatedPipelineRuns.length).fill(1);
    
    for(let x = 0; x < generatedPipelineRuns.length; x++){
      let run = generatedPipelineRuns[x];
      let encodedParameterization = this.generateJobParameters([run], [1])[0];

      let needleIndex = this.findParameterization(encodedParameterization, _parameters);
      if(needleIndex >= 0){
        selectedIndices[x] = 1;
        // remove found parameterization from _parameters, as to not count duplicates
        _parameters.splice(needleIndex, 1);
      }else {
        selectedIndices[x] = 0;
      }
    }

    return selectedIndices;
  }

  generateParameterLists(parameters) {
    let parameterLists = {};

    for (const paramKey in parameters) {
      // Note: the list of parameters for each key will always be
      // a string in the 'strategyJSON' data structure. This
      // facilitates preserving user added indendation.

      // Validity of the user string as JSON is checked client
      // side (for now).
      parameterLists[paramKey] = JSON.stringify([parameters[paramKey]]);
    }

    return parameterLists;
  }

  generateStrategyJson(pipeline) {
    let strategyJSON = {};

    if (pipeline.parameters && Object.keys(pipeline.parameters).length > 0) {
      strategyJSON[
        this.context.state?.config?.PIPELINE_PARAMETERS_RESERVED_KEY
      ] = {
        key: this.context.state?.config?.PIPELINE_PARAMETERS_RESERVED_KEY,
        parameters: this.generateParameterLists(pipeline.parameters),
        title: pipeline.name,
      };
    }

    for (const stepUUID in pipeline.steps) {
      let stepStrategy = JSON.parse(JSON.stringify(pipeline.steps[stepUUID]));

      if (
        stepStrategy.parameters &&
        Object.keys(stepStrategy.parameters).length > 0
      ) {
        // selectively persist only required fields for use in parameter
        // related React components
        strategyJSON[stepUUID] = {
          key: stepUUID,
          parameters: this.generateParameterLists(stepStrategy.parameters),
          title: stepStrategy.title,
        };
      }
    }

    return strategyJSON;
  }

  onSelectSubview(index) {
    this.setState({
      selectedTabIndex: index,
    });
  }

  componentDidMount() {
    this.fetchJob();

    this.context.dispatch({
      type: "setUnsavedChanges",
      payload: this.state.unsavedChanges,
    });
  }

  componentDidUpdate(_, prevState) {
    if (this.state.unsavedChanges !== prevState.unsavedChanges) {
      this.context.dispatch({
        type: "setUnsavedChanges",
        payload: this.state.unsavedChanges,
      });
    }
  }

  generateWithStrategy(strategyJSON) {
    // flatten and JSONify strategyJSON to prep data structure for algo
    let flatParameters = {};

    for (const strategyJSONKey in strategyJSON) {
      for (const paramKey in strategyJSON[strategyJSONKey].parameters) {
        let fullParam = strategyJSONKey + "#" + paramKey;

        flatParameters[fullParam] = JSON.parse(
          strategyJSON[strategyJSONKey].parameters[paramKey]
        );
      }
    }

    let recursivelyGenerate = function (params, accum, unpacked) {
      // deep clone unpacked
      unpacked = JSON.parse(JSON.stringify(unpacked));

      for (const fullParam in params) {
        if (unpacked.indexOf(fullParam) === -1) {
          unpacked.push(fullParam);

          for (const idx in params[fullParam]) {
            // deep clone params
            let localParams = JSON.parse(JSON.stringify(params));

            // collapse param list to paramValue
            localParams[fullParam] = params[fullParam][idx];

            recursivelyGenerate(localParams, accum, unpacked);
          }
          return;
        }
      }

      accum.push(params);
    };

    let generatedPipelineRuns = [];

    recursivelyGenerate(flatParameters, generatedPipelineRuns, []);

    // transform pipelineRuns for generatedPipelineRunRows DataTable format
    let generatedPipelineRunRows = [];

    for (let idx in generatedPipelineRuns) {
      let params = generatedPipelineRuns[idx];

      let pipelineRunRow = [];

      for (let fullParam in params) {
        let paramName = fullParam.split("#").slice(1).join("");
        pipelineRunRow.push(
          paramName + ": " + JSON.stringify(params[fullParam])
        );
      }
      if (pipelineRunRow.length > 0) {
        generatedPipelineRunRows.push([pipelineRunRow.join(", ")]);
      } else {
        generatedPipelineRunRows.push([<i>Parameterless run</i>]);
      }
    }

    let selectedIndices = Array(generatedPipelineRunRows.length).fill(1);

    return [generatedPipelineRuns, generatedPipelineRunRows, selectedIndices];
  }

  validateJobConfig() {
    if (this.state.selectedIndices.reduce((acc, val) => acc + val, 0) == 0) {
      return {
        pass: false,
        reason:
          "You selected 0 pipeline runs. Please choose at least one pipeline run configuration.",
      };
    }
    return { pass: true };
  }

  attemptRunJob() {
    // validate job configuration
    let validation = this.validateJobConfig();

    if (validation.pass === true) {
      checkGate(this.state.job.project_uuid)
        .then(() => {
          this.runJob();
        })
        .catch((result) => {
          if (result.reason === "gate-failed") {
            orchest.requestBuild(
              this.state.job.project_uuid,
              result.data,
              "CreateJob",
              () => {
                this.attemptRunJob();
              }
            );
          }
        });
    } else {
      orchest.alert("Error", validation.reason);
    }
  }

  runJob() {
    this.setState({
      runJobLoading: true,
      unsavedChanges: false,
    });

    let envVariables = envVariablesArrayToDict(this.state.envVariables);
    // Do not go through if env variables are not correctly defined.
    if (envVariables === undefined) {
      this.setState({
        runJobLoading: false,
      });
      this.onSelectSubview(1);
      return;
    }

    let jobPUTData = {
      confirm_draft: true,
      strategy_json: this.state.strategyJSON,
      parameters: this.generateJobParameters(
        this.state.generatedPipelineRuns,
        this.state.selectedIndices
      ),
      env_variables: envVariables,
    };

    if (this.state.scheduleOption === "scheduled") {
      let formValueScheduledStart = this.refManager.refs.scheduledDateTime.getISOString();

      // API doesn't accept ISO date strings with 'Z' suffix
      // Instead, endpoint assumes its passed a UTC datetime string.
      if (formValueScheduledStart[formValueScheduledStart.length - 1] === "Z") {
        formValueScheduledStart = formValueScheduledStart.slice(
          0,
          formValueScheduledStart.length - 1
        );
      }

      jobPUTData.next_scheduled_time = formValueScheduledStart;
    } else if (this.state.scheduleOption === "cron") {
      jobPUTData.cron_schedule = this.state.cronString;
    }
    // Else: both entries are undefined, the run is considered to be
    // started ASAP.

    // Update orchest-api through PUT.
    // Note: confirm_draft will trigger the start the job.
    let putJobPromise = makeCancelable(
      makeRequest("PUT", "/catch/api-proxy/api/jobs/" + this.state.job.uuid, {
        type: "json",
        content: jobPUTData,
      }),
      this.promiseManager
    );

    putJobPromise.promise
      .then(() => {
        orchest.loadView(JobsView, {
          queryArgs: {
            project_uuid: this.state.job.project_uuid,
          },
        });
      })
      .catch((response) => {
        if (!response.isCanceled) {
          try {
            let result = JSON.parse(response.body);

            orchest.alert("Error", "Failed to start job. " + result.message);

            orchest.loadView(JobsView, {
              queryArgs: {
                project_uuid: this.state.job.project_uuid,
              },
            });
          } catch (error) {
            console.log("error");
          }
        }
      });
  }

  putJobChanges() {
    /* This function should only be called
     *  for jobs with a cron schedule. As those
     *  are the only ones that are allowed to be changed
     *  when they are not a draft.
     */

    let jobParameters = this.generateJobParameters(
      this.state.generatedPipelineRuns,
      this.state.selectedIndices
    );

    let cronSchedule = this.state.cronString;
    let envVariables = envVariablesArrayToDict(this.state.envVariables);
    // Do not go through if env variables are not correctly defined.
    if (envVariables === undefined) {
      this.onSelectSubview(1);
      return;
    }

    // saving changes
    this.setState({
      unsavedChanges: false,
    });

    let putJobRequest = makeCancelable(
      makeRequest("PUT", `/catch/api-proxy/api/jobs/${this.state.job.uuid}`, {
        type: "json",
        content: {
          cron_schedule: cronSchedule,
          parameters: jobParameters,
          strategy_json: this.state.strategyJSON,
          env_variables: envVariables,
        },
      }),
      this.promiseManager
    );

    putJobRequest.promise
      .then(() => {
        orchest.loadView(JobView, {
          queryArgs: {
            job_uuid: this.state.job.uuid,
          },
        });
      })
      .catch((error) => {
        console.error(error);
      });
  }

  generateJobParameters(generatedPipelineRuns, selectedIndices) {
    let parameters = [];

    for (let x = 0; x < generatedPipelineRuns.length; x++) {
      if (selectedIndices[x] === 1) {
        let runParameters = generatedPipelineRuns[x];
        let selectedRunParameters = {};

        // key is formatted: <stepUUID>#<parameterKey>
        for (let key in runParameters) {
          let keySplit = key.split("#");
          let stepUUID = keySplit[0];
          let parameterKey = keySplit.slice(1).join("#");

          if (selectedRunParameters[stepUUID] === undefined)
            selectedRunParameters[stepUUID] = {};

          selectedRunParameters[stepUUID][parameterKey] = runParameters[key];
        }

        parameters.push(selectedRunParameters);
      }
    }

    return parameters;
  }

  cancel() {
    orchest.loadView(JobsView, {
      queryArgs: {
        project_uuid: this.state.job.project_uuid,
      },
    });
  }

  onPipelineRunsSelectionChanged(selectedRows, rows) {
    // map selectedRows to selectedIndices
    let selectedIndices = this.state.selectedIndices;

    // for indexOf to work on arrays in this.generatedPipelineRuns it
    // depends on the object (array object) being the same (same reference!)
    for (let x = 0; x < rows.length; x++) {
      let index = this.state.generatedPipelineRunRows.indexOf(rows[x]);

      if (index === -1) {
        console.error("row should always be in generatedPipelineRunRows");
      }

      if (selectedRows.indexOf(rows[x]) !== -1) {
        selectedIndices[index] = 1;
      } else {
        selectedIndices[index] = 0;
      }
    }

    this.setState({
      selectedIndices: selectedIndices,
    });
  }

  parameterValueOverride(strategyJSON, parameters) {
    for (let key in parameters) {
      let splitKey = key.split("#");
      let strategyJSONKey = splitKey[0];
      let paramKey = splitKey.slice(1).join("#");
      let paramValue = parameters[key];

      strategyJSON[strategyJSONKey]["parameters"][paramKey] = paramValue;
    }

    return strategyJSON;
  }

  setCronSchedule(cronString) {
    this.setState({
      cronString: cronString,
      scheduleOption: "cron",
    });
  }

  addEnvVariablePair(e) {
    e.preventDefault();

    const envVariables = this.state.envVariables.slice();
    this.setState({
      envVariables: envVariables.concat([
        {
          name: null,
          value: null,
        },
      ]),
    });
  }

  onEnvVariablesChange(value, idx, type) {
    const envVariables = this.state.envVariables.slice();
    envVariables[idx][type] = value;

    this.setState({
      envVariables: envVariables,
    });
  }

  onEnvVariablesDeletion(idx) {
    const envVariables = this.state.envVariables.slice();
    envVariables.splice(idx, 1);
    this.setState({
      envVariables: envVariables,
    });
  }

  detailRows(pipelineParameters, strategyJSON) {
    let detailElements = [];

    // override values in fields through param fields
    for (let x = 0; x < pipelineParameters.length; x++) {
      let parameters = pipelineParameters[x];
      strategyJSON = _.cloneDeep(strategyJSON);
      strategyJSON = this.parameterValueOverride(strategyJSON, parameters);

      detailElements.push(
        <div className="pipeline-run-detail">
          <ParamTree
            pipelineName={this.state.pipeline.name}
            strategyJSON={strategyJSON}
          />
        </div>
      );
    }

    return detailElements;
  }

  render() {
    let rootView = undefined;

    if (this.state.job && this.state.pipeline) {
      let tabView = undefined;

      switch (this.state.selectedTabIndex) {
        case 0:
          tabView = (
            <div className="tab-view">
              {this.state.job.status === "DRAFT" && (
                <div>
                  <div className="push-down">
                    <MDCRadioReact
                      label="Now"
                      value="now"
                      name="time"
                      checked={this.state.scheduleOption === "now"}
                      onChange={(e) => {
                        this.setState({ scheduleOption: e.target.value });
                      }}
                    />
                  </div>
                  <div className="push-down">
                    <MDCRadioReact
                      label="Scheduled"
                      value="scheduled"
                      name="time"
                      checked={this.state.scheduleOption === "scheduled"}
                      onChange={(e) => {
                        this.setState({ scheduleOption: e.target.value });
                      }}
                    />
                  </div>
                  <div>
                    <DateTimeInput
                      disabled={this.state.scheduleOption !== "scheduled"}
                      ref={this.refManager.nrefs.scheduledDateTime}
                      onFocus={() =>
                        this.setState({ scheduleOption: "scheduled" })
                      }
                    />
                  </div>
                </div>
              )}

              {this.state.job.status === "DRAFT" && (
                <div className="push-down">
                  <MDCRadioReact
                    label="Cron job"
                    value="cron"
                    name="time"
                    checked={this.state.scheduleOption === "cron"}
                    onChange={(e) => {
                      this.setState({ scheduleOption: e.target.value });
                    }}
                  />
                </div>
              )}

              <div>
                <CronScheduleInput
                  cronString={this.state.cronString}
                  onChange={this.setCronSchedule.bind(this)}
                  disabled={this.state.scheduleOption !== "cron"}
                />
              </div>
            </div>
          );

          break;
        case 1:
          tabView = (
            <div className="tab-view">
              <ParameterEditor
                pipelineName={this.state.pipeline.name}
                onParameterChange={(strategyJSON) => {
                  let [
                    generatedPipelineRuns,
                    generatedPipelineRunRows,
                    selectedIndices,
                  ] = this.generateWithStrategy(strategyJSON);
                  this.setState({
                    strategyJSON,
                    generatedPipelineRuns,
                    generatedPipelineRunRows,
                    selectedIndices,
                  });
                }}
                strategyJSON={_.cloneDeep(this.state.strategyJSON)}
              />
            </div>
          );
          break;
        case 2:
          tabView = (
            <div className="tab-view">
              <p className="push-down">
                Override any project or pipeline environment variables here.
              </p>
              <EnvVarList
                value={this.state.envVariables}
                onAdd={this.addEnvVariablePair.bind(this)}
                onChange={(e, idx, type) =>
                  this.onEnvVariablesChange(e, idx, type)
                }
                onDelete={(idx) => this.onEnvVariablesDeletion(idx)}
              />
            </div>
          );
          break;
        case 3:
          tabView = (
            <div className="pipeline-tab-view pipeline-runs">
              <SearchableTable
                selectable={true}
                headers={["Run specification"]}
                detailRows={this.detailRows(
                  this.state.generatedPipelineRuns,
                  this.state.strategyJSON
                )}
                rows={this.state.generatedPipelineRunRows}
                selectedIndices={this.state.selectedIndices}
                onSelectionChanged={this.onPipelineRunsSelectionChanged.bind(
                  this
                )}
              />
            </div>
          );
          break;
      }

      rootView = (
        <Fragment>
          <DescriptionList
            gap="5"
            columnGap="10"
            columns={{ initial: 1, "@lg": 2 }}
            css={{ marginBottom: "$5" }}
            items={[
              { term: "Job", details: this.state.job.name },
              { term: "pipeline", details: this.state.pipeline.name },
            ]}
          />

          <MDCTabBarReact
            selectedIndex={this.state.selectedTabIndex}
            ref={this.refManager.nrefs.tabBar}
            items={[
              "Scheduling",
              "Parameters",
              "Environment variables",
              "Pipeline runs (" +
                this.state.selectedIndices.reduce(
                  (total, num) => total + num,
                  0
                ) +
                "/" +
                this.state.generatedPipelineRuns.length +
                ")",
            ]}
            icons={["schedule", "tune", "view_comfy", "list"]}
            onChange={this.onSelectSubview.bind(this)}
          />

          <div className="tab-view">{tabView}</div>

          <div className="buttons">
            {this.state.job.status === "DRAFT" && (
              <MDCButtonReact
                disabled={this.state.runJobLoading}
                classNames={["mdc-button--raised", "themed-secondary"]}
                onClick={this.attemptRunJob.bind(this)}
                icon="play_arrow"
                label="Run job"
              />
            )}
            {this.state.job.status !== "DRAFT" && (
              <MDCButtonReact
                classNames={["mdc-button--raised", "themed-secondary"]}
                onClick={this.putJobChanges.bind(this)}
                icon="save"
                label="Update job"
              />
            )}
            <MDCButtonReact
              onClick={this.cancel.bind(this)}
              label="Cancel"
              icon="close"
            />
          </div>
        </Fragment>
      );
    } else {
      rootView = <MDCLinearProgressReact />;
    }

    return (
      <Layout>
        <div className="view-page job-view">{rootView}</div>
      </Layout>
    );
  }
}

export default EditJobView;
