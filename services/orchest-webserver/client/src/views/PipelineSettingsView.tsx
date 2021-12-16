import { Code } from "@/components/common/Code";
import { IconButton } from "@/components/common/IconButton";
import { TabLabel, TabPanel, Tabs } from "@/components/common/Tabs";
import {
  DataTable,
  DataTableColumn,
  DataTableRow,
} from "@/components/DataTable";
import EnvVarList from "@/components/EnvVarList";
import { Layout } from "@/components/Layout";
import ServiceForm from "@/components/ServiceForm";
import { ServiceTemplatesDialog } from "@/components/ServiceTemplatesDialog";
import { ServiceTemplate } from "@/components/ServiceTemplatesDialog/content";
import { useAppContext } from "@/contexts/AppContext";
import { useProjectsContext } from "@/contexts/ProjectsContext";
import { useSessionsContext } from "@/contexts/SessionsContext";
import { useCustomRoute } from "@/hooks/useCustomRoute";
import { useSendAnalyticEvent } from "@/hooks/useSendAnalyticEvent";
import { useSessionsPoller } from "@/hooks/useSessionsPoller";
import { siteMap } from "@/Routes";
import type {
  PipelineJson,
  Service,
  TViewPropsWithRequiredQueryArgs,
} from "@/types";
import {
  envVariablesArrayToDict,
  envVariablesDictToArray,
  getPipelineJSONEndpoint,
  isValidEnvironmentVariableName,
  OverflowListener,
  validatePipeline,
} from "@/utils/webserver-utils";
import DeleteIcon from "@mui/icons-material/Delete";
import ListIcon from "@mui/icons-material/List";
import MiscellaneousServicesIcon from "@mui/icons-material/MiscellaneousServices";
import ViewComfyIcon from "@mui/icons-material/ViewComfy";
import LinearProgress from "@mui/material/LinearProgress";
import { styled } from "@mui/material/styles";
import Tab from "@mui/material/Tab";
import Tooltip from "@mui/material/Tooltip";
import {
  Alert,
  AlertDescription,
  AlertHeader,
  Box,
  IconLightBulbOutline,
  Link,
} from "@orchest/design-system";
import {
  MDCButtonReact,
  MDCCheckboxReact,
  MDCTextFieldReact,
} from "@orchest/lib-mdc";
import {
  fetcher,
  makeCancelable,
  makeRequest,
  PromiseManager,
} from "@orchest/lib-utils";
import "codemirror/mode/javascript/javascript";
import _ from "lodash";
import React, { useRef, useState } from "react";
import { Controlled as CodeMirror } from "react-codemirror2";
import useSWR, { MutatorCallback } from "swr";

const CustomTabPanel = styled(TabPanel)(({ theme }) => ({
  padding: theme.spacing(4, 0),
}));

export type IPipelineSettingsView = TViewPropsWithRequiredQueryArgs<
  "pipeline_uuid" | "project_uuid"
>;

const tabMapping: Record<string, number> = {
  configuration: 0,
  "environment-variables": 1,
  services: 2,
};

const tabs = [
  {
    id: "configuration-tab",
    label: "Configuration",
    icon: <ListIcon />,
  },
  {
    id: "environment-variables-tab",
    label: "Environment variables",
    icon: <ViewComfyIcon />,
  },
  {
    id: "services-tab",
    label: "Services",
    icon: <MiscellaneousServicesIcon />,
  },
];

const getOrderValue = () => {
  const lsKey = "_monotonic_getOrderValue";
  // returns monotinically increasing digit
  if (!window.localStorage.getItem(lsKey)) {
    window.localStorage.setItem(lsKey, "0");
  }
  let value = parseInt(window.localStorage.getItem(lsKey)) + 1;
  window.localStorage.setItem(lsKey, value + "");
  return value;
};

const fetchPipelineJson = async (url: string) => {
  const response = await fetcher<{ pipeline_json: string }>(url);
  const pipelineObj = JSON.parse(response.pipeline_json) as PipelineJson;
  // as settings are optional, populate defaults if no values exist
  if (pipelineObj.settings === undefined) {
    pipelineObj.settings = {};
  }
  if (pipelineObj.settings.auto_eviction === undefined) {
    pipelineObj.settings.auto_eviction = false;
  }
  if (pipelineObj.settings.data_passing_memory_size === undefined) {
    pipelineObj.settings.data_passing_memory_size = "1GB";
  }
  if (pipelineObj.parameters === undefined) {
    pipelineObj.parameters = {};
  }
  if (pipelineObj.services === undefined) {
    pipelineObj.services = {};
  }

  // Augment services with order key
  for (let service in pipelineObj.services) {
    pipelineObj.services[service].order = getOrderValue();
  }
  return pipelineObj;
};

const isValidMemorySize = (value: string) =>
  value.match(/^(\d+(\.\d+)?\s*(KB|MB|GB))$/);

const scopeMap = {
  interactive: "Interactive sessions",
  noninteractive: "Job sessions",
};

const PipelineSettingsView: React.FC = () => {
  // global states
  const projectsContext = useProjectsContext();
  const {
    state: { hasUnsavedChanges },
    setAlert,
    setConfirm,
    setAsSaved,
  } = useAppContext();

  useSendAnalyticEvent("view load", { name: siteMap.pipelineSettings.path });

  const sessionsContext = useSessionsContext();
  const { getSession } = sessionsContext;
  useSessionsPoller();

  // data from route
  const {
    navigateTo,
    projectUuid,
    pipelineUuid,
    jobUuid,
    runUuid,
    initialTab,
    isReadOnly,
  } = useCustomRoute();

  // local states
  const {
    data: pipelineJson,
    mutate,
    revalidate: fetchPipeline,
    error,
  } = useSWR<PipelineJson>(
    getPipelineJSONEndpoint(pipelineUuid, projectUuid, jobUuid, runUuid),
    fetchPipelineJson
  );

  // use mutate to act like local state setter
  const setPipelineJson = (
    data?: PipelineJson | Promise<PipelineJson> | MutatorCallback<PipelineJson>
  ) => mutate(data, false);

  const [tabIndex, setTabIndex] = useState<number>(
    tabMapping[initialTab] || 0 // note that initialTab can be 'null' since it's a querystring
  );

  // const [pipelineJson, setPipelineJson] = React.useState<PipelineJson>();
  const [servicesChanged, setServicesChanged] = React.useState(false);

  const [state, setState] = React.useState({
    inputParameters: JSON.stringify({}, null, 2),
    restartingMemoryServer: false,
    pipeline_path: undefined,
    // dataPassingMemorySize: "1GB",
    // pipelineJson: undefined,
    envVariables: [],
    projectEnvVariables: [],
    // servicesChanged: false,
    environmentVariablesChanged: false,
  });

  const session = getSession({
    pipelineUuid,
    projectUuid,
  });
  if (
    !session &&
    !hasUnsavedChanges &&
    (servicesChanged || state.environmentVariablesChanged)
  ) {
    setServicesChanged(false);
    setState((prevState) => ({
      ...prevState,
      environmentVariablesChanged: false,
    }));
  }

  const [overflowListener] = React.useState(new OverflowListener());
  const promiseManagerRef = useRef(new PromiseManager<string>());

  const fetchPipelineData = () => {
    fetchPipeline();
    fetchPipelineMetadata();
  };

  const hasLoaded = () => {
    return (
      pipelineJson &&
      state.envVariables &&
      (isReadOnly || state.projectEnvVariables)
    );
  };

  // Fetch pipeline data on initial mount
  React.useEffect(() => {
    fetchPipelineData();
    return () => promiseManagerRef.current.cancelCancelablePromises();
  }, []);

  // If the component has loaded, attach the resize listener
  React.useEffect(() => {
    if (hasLoaded()) {
      attachResizeListener();
    }
  }, [state]);

  const setHeaderComponent = (pipelineName: string) =>
    projectsContext.dispatch({
      type: "pipelineSet",
      payload: {
        pipelineUuid,
        projectUuid,
        pipelineName,
      },
    });

  const addServiceFromTemplate = (service: ServiceTemplate["config"]) => {
    let clonedService = _.cloneDeep(service);

    // Take care of service name collisions
    let x = 1;
    let baseServiceName = clonedService.name;
    while (x < 100) {
      if (pipelineJson.services[clonedService.name] == undefined) {
        break;
      }
      clonedService.name = baseServiceName + x;
      x++;
    }

    onChangeService(clonedService);
  };

  const onChangeService = (service: Service) => {
    setPipelineJson((current) => {
      // Maintain client side order key
      if (service.order === undefined) service.order = getOrderValue();
      current.services[service.name] = service;
      return current;
    });

    setServicesChanged(true);
    setAsSaved(false);
  };

  const nameChangeService = (oldName: string, newName: string) => {
    setPipelineJson((current) => {
      current[newName] = current[oldName];
      delete current.services[oldName];
      return current;
    });
    setServicesChanged(true);
    setAsSaved(false);
  };

  const deleteService = async (serviceName: string) => {
    setPipelineJson((current) => {
      delete current.services[serviceName];
      return current;
    });

    setServicesChanged(true);
    setAsSaved(false);
    return true;
  };

  const attachResizeListener = () => overflowListener.attach();

  const onSelectTab = (
    e: React.SyntheticEvent<Element, Event>,
    index: number
  ) => {
    setTabIndex(index);
  };

  const fetchPipelineMetadata = () => {
    if (!jobUuid) {
      // get pipeline path
      let cancelableRequest = makeCancelable<string>(
        makeRequest(
          "GET",
          `/async/pipelines/${projectUuid}/${pipelineUuid}`
        ) as Promise<string>,
        promiseManagerRef.current
      );

      cancelableRequest.promise.then((response: string) => {
        let pipeline = JSON.parse(response);

        setState((prevState) => ({
          ...prevState,
          pipeline_path: pipeline.path,
          envVariables: envVariablesDictToArray(pipeline["env_variables"]),
        }));
      });

      // get project environment variables
      let cancelableProjectRequest = makeCancelable<string>(
        makeRequest("GET", `/async/projects/${projectUuid}`) as Promise<string>,
        promiseManagerRef.current
      );

      cancelableProjectRequest.promise
        .then((response) => {
          let project = JSON.parse(response);

          setState((prevState) => ({
            ...prevState,
            projectEnvVariables: envVariablesDictToArray(
              project["env_variables"]
            ),
          }));
        })
        .catch((error) => {
          console.error(error);
        });
    } else {
      let cancelableJobPromise = makeCancelable<string>(
        makeRequest("GET", `/catch/api-proxy/api/jobs/${jobUuid}`) as Promise<
          string
        >,
        promiseManagerRef.current
      );
      let cancelableRunPromise = makeCancelable<string>(
        makeRequest(
          "GET",
          `/catch/api-proxy/api/jobs/${jobUuid}/${runUuid}`
        ) as Promise<string>,
        promiseManagerRef.current
      );

      Promise.all([
        cancelableJobPromise.promise.then((response) => {
          let job = JSON.parse(response);
          return job.pipeline_run_spec.run_config.pipeline_path;
        }),

        cancelableRunPromise.promise.then((response) => {
          let run = JSON.parse(response);
          return envVariablesDictToArray(run["env_variables"]);
        }),
      ])
        .then((values) => {
          let [pipeline_path, envVariables] = values;
          setState((prevState) => ({
            ...prevState,
            pipeline_path,
            envVariables,
          }));
        })
        .catch((err) => console.log(err));
    }
  };

  const closeSettings = () => {
    navigateTo(siteMap.pipeline.path, {
      query: {
        projectUuid,
        pipelineUuid,
        jobUuid,
        runUuid,
      },
      state: { isReadOnly },
    });
  };

  const onChangeName = (value: string) => {
    setPipelineJson((current) => ({ ...current, name: value }));
    setAsSaved(false);
  };

  const onChangePipelineParameters = (editor, data, value) => {
    setState((prevState) => ({
      ...prevState,
      inputParameters: value,
    }));

    try {
      const parametersJSON = JSON.parse(value);
      setPipelineJson((current) => ({
        ...current,
        parameters: parametersJSON,
      }));

      setAsSaved(false);
    } catch (err) {
      console.log("JSON did not parse");
    }
  };

  const onChangeDataPassingMemorySize = (value: string) => {
    if (isValidMemorySize(value)) {
      setPipelineJson((current) => {
        return {
          ...current,
          settings: { ...current.settings, data_passing_memory_size: value },
        };
      });
      setAsSaved(false);
    }
  };

  const onChangeEviction = (value: boolean) => {
    setPipelineJson((current) => {
      return {
        ...current,
        settings: { ...current.settings, auto_eviction: value },
      };
    });

    setAsSaved(false);
  };

  const addEnvVariablePair = (e) => {
    e.preventDefault();

    setState((prevState) => {
      const envVariables = prevState.envVariables.slice();

      return {
        ...prevState,
        envVariables: envVariables.concat([
          {
            name: null,
            value: null,
          },
        ]),
      };
    });
  };

  const onEnvVariablesChange = (value, idx, type) => {
    setState((prevState) => {
      const envVariables = prevState.envVariables.slice();
      envVariables[idx][type] = value;

      return { ...prevState, envVariables, environmentVariablesChanged: true };
    });
    setAsSaved(false);
  };

  const onEnvVariablesDeletion = (idx) => {
    setState((prevState) => {
      const envVariables = prevState.envVariables.slice();
      envVariables.splice(idx, 1);

      return { ...prevState, envVariables };
    });
    setAsSaved(false);
  };

  const cleanPipelineJson = (pipelineJson: PipelineJson) => {
    let pipelineCopy = _.cloneDeep(pipelineJson);
    for (let serviceName in pipelineCopy.services) {
      delete pipelineCopy.services[serviceName].order;
    }
    return pipelineCopy;
  };

  const validateServiceEnvironmentVariables = (pipeline: any) => {
    for (let serviceName in pipeline.services) {
      let service = pipeline.services[serviceName];

      if (service.env_variables === undefined) {
        continue;
      }

      for (let envVariableName of Object.keys(service.env_variables)) {
        if (!isValidEnvironmentVariableName(envVariableName)) {
          setAlert(
            "Error",
            `Invalid environment variable name: "${envVariableName}" in service "${service.name}".`
          );
          return false;
        }
      }
    }
    return true;
  };

  const saveGeneralForm = (e: MouseEvent) => {
    e.preventDefault();

    // Remove order property from services
    let requestPayload = cleanPipelineJson(pipelineJson);

    let validationResult = validatePipeline(requestPayload);
    if (!validationResult.valid) {
      setAlert("Error", validationResult.errors[0]);
      return;
    }

    // Validate environment variables of services
    if (!validateServiceEnvironmentVariables(requestPayload)) {
      return;
    }

    let envVariables = envVariablesArrayToDict(state.envVariables);
    // Do not go through if env variables are not correctly defined.
    if (envVariables.status === "rejected") {
      setAlert("Error", envVariables.error);
      setTabIndex(1);
      return;
    }

    // Validate pipeline level environment variables
    for (let envVariableName of Object.keys(envVariables.value)) {
      if (!isValidEnvironmentVariableName(envVariableName)) {
        setAlert(
          "Error",
          `Invalid environment variable name: "${envVariableName}".`
        );
        setTabIndex(1);
        return;
      }
    }

    let formData = new FormData();
    formData.append("pipeline_json", JSON.stringify(requestPayload));

    makeRequest(
      "POST",
      `/async/pipelines/json/${projectUuid}/${pipelineUuid}`,
      { type: "FormData", content: formData }
    )
      .then((response: string) => {
        let result = JSON.parse(response);
        if (result.success) {
          setState((prevState) => ({
            ...prevState,
          }));
          setAsSaved();

          // Sync name changes with the global context
          projectsContext.dispatch({
            type: "pipelineSet",
            payload: {
              pipelineName: pipelineJson?.name,
            },
          });
        }
      })
      .catch((response) => {
        console.error("Could not save: pipeline definition OR Notebook JSON");
        console.error(response);
      });

    makeRequest("PUT", `/async/pipelines/${projectUuid}/${pipelineUuid}`, {
      type: "json",
      content: { env_variables: envVariables.value },
    }).catch((response) => {
      console.error(response);
    });
  };

  const restartMemoryServer = () => {
    if (!state.restartingMemoryServer) {
      setState((prevState) => ({
        ...prevState,
        restartingMemoryServer: true,
      }));

      // perform POST to save
      let restartPromise = makeCancelable(
        makeRequest(
          "PUT",
          `/catch/api-proxy/api/sessions/${projectUuid}/${pipelineUuid}`
        ),
        promiseManagerRef.current
      );

      restartPromise.promise
        .then(() => {
          setState((prevState) => ({
            ...prevState,
            restartingMemoryServer: false,
          }));
        })
        .catch((response) => {
          if (!response.isCanceled) {
            let errorMessage =
              "Could not clear memory server, reason unknown. Please try again later.";
            try {
              errorMessage = JSON.parse(response.body)["message"];
              if (errorMessage == "SessionNotRunning") {
                errorMessage =
                  "Session is not running, please try again later.";
              }
            } catch (error) {
              console.error(error);
            }

            setAlert("Error", errorMessage);

            setState((prevState) => ({
              ...prevState,
              restartingMemoryServer: false,
            }));
          }
        });
    } else {
      console.error(
        "Already busy restarting memory server. UI should prohibit this call."
      );
    }
  };

  type ServiceRow = { name: string; scope: string; remove: string };

  const columns: DataTableColumn<ServiceRow>[] = [
    { id: "name", label: "Service" },
    { id: "scope", label: "Scope" },
    {
      id: "remove",
      label: "Delete",
      render: (row) => (
        <IconButton
          title="Delete"
          disabled={isReadOnly}
          onClick={() => {
            setConfirm(
              "Warning",
              "Are you sure you want to delete the service: " + row.name + "?",
              async () => deleteService(row.name)
            );
          }}
        >
          <DeleteIcon />
        </IconButton>
      ),
    },
  ];

  const serviceRows: DataTableRow<ServiceRow>[] = !pipelineJson
    ? []
    : Object.entries(pipelineJson.services)
        .sort((a, b) => a[1].order - b[1].order)
        .map(([key, service]) => {
          return {
            uuid: key,
            name: key,
            scope: service.scope
              .map((scopeAsString) => scopeMap[scopeAsString])
              .join(", "),
            remove: key,
            details: (
              <ServiceForm
                key={`ServiceForm-${key}`}
                service={service}
                disabled={isReadOnly}
                updateService={onChangeService}
                nameChangeService={nameChangeService}
                pipeline_uuid={pipelineUuid}
                project_uuid={projectUuid}
                run_uuid={runUuid}
              />
            ),
          };
        });

  return (
    <Layout>
      <div className="view-page pipeline-settings-view">
        {hasLoaded() ? (
          <div className="pipeline-settings">
            <h2>Pipeline settings</h2>

            <Tabs
              value={tabIndex}
              onChange={onSelectTab}
              label="View pipeline settings"
              data-test-id="pipeline-settings"
            >
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  id={tab.id}
                  label={<TabLabel icon={tab.icon}>{tab.label}</TabLabel>}
                  aria-controls={tab.id}
                />
              ))}
            </Tabs>

            <div className="tab-view trigger-overflow">
              <CustomTabPanel value={tabIndex} index={0} name="configuration">
                <div className="configuration">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <div className="columns">
                      <div className="column">
                        <h3>Name</h3>
                      </div>
                      <div className="column">
                        <MDCTextFieldReact
                          value={pipelineJson?.name}
                          onChange={onChangeName}
                          label="Pipeline name"
                          disabled={isReadOnly}
                          classNames={["push-down"]}
                          data-test-id="pipeline-settings-configuration-pipeline-name"
                        />
                      </div>
                      <div className="clear"></div>
                    </div>

                    <div className="columns">
                      <div className="column">
                        <h3>Path</h3>
                      </div>
                      <div className="column">
                        {state.pipeline_path && (
                          <p className="push-down">
                            <Code>{state.pipeline_path}</Code>
                          </p>
                        )}
                      </div>
                      <div className="clear"></div>
                    </div>

                    <div className="columns">
                      <div className="column">
                        <h3>Pipeline parameters</h3>
                      </div>
                      <div className="column">
                        <CodeMirror
                          value={state.inputParameters}
                          options={{
                            mode: "application/json",
                            theme: "jupyter",
                            lineNumbers: true,
                            readOnly: isReadOnly,
                          }}
                          onBeforeChange={onChangePipelineParameters}
                        />
                        {(() => {
                          try {
                            JSON.parse(state.inputParameters);
                          } catch {
                            return (
                              <div className="warning push-up push-down">
                                <i className="material-icons">warning</i> Your
                                input is not valid JSON.
                              </div>
                            );
                          }
                        })()}
                      </div>
                      <div className="clear"></div>
                    </div>

                    <div className="columns">
                      <div className="column">
                        <h3>Data passing</h3>
                      </div>
                      <div className="column">
                        {!isReadOnly && (
                          <p className="push-up">
                            <i>
                              For these changes to take effect you have to
                              restart the memory-server (see button below).
                            </i>
                          </p>
                        )}

                        <div className="checkbox-tooltip-holder">
                          <MDCCheckboxReact
                            value={pipelineJson?.settings?.auto_eviction}
                            onChange={onChangeEviction}
                            label="Automatic memory eviction"
                            disabled={isReadOnly}
                            classNames={["push-down", "push-up"]}
                            data-test-id="pipeline-settings-configuration-memory-eviction"
                          />
                          <Tooltip title="Auto eviction makes sure outputted objects are evicted once all depending steps have obtained it as an input.">
                            <i
                              className="material-icons inline-icon push-up"
                              aria-describedby="tooltip-memory-eviction"
                            >
                              info
                            </i>
                          </Tooltip>
                        </div>

                        {!isReadOnly && (
                          <p className="push-down">
                            Change the size of the memory server for data
                            passing. For units use KB, MB, or GB, e.g.{" "}
                            <Code>1GB</Code>.{" "}
                          </p>
                        )}

                        <div>
                          <MDCTextFieldReact
                            value={
                              pipelineJson.settings.data_passing_memory_size
                            }
                            onChange={onChangeDataPassingMemorySize}
                            label="Data passing memory size"
                            disabled={isReadOnly}
                            data-test-id="pipeline-settings-configuration-memory-size"
                          />
                        </div>
                        {(() => {
                          if (
                            !isValidMemorySize(
                              pipelineJson.settings.data_passing_memory_size
                            )
                          ) {
                            return (
                              <div className="warning push-up">
                                <i className="material-icons">warning</i> Not a
                                valid memory size.
                              </div>
                            );
                          }
                        })()}
                      </div>
                      <div className="clear"></div>
                    </div>
                  </form>

                  {!isReadOnly && (
                    <div className="columns">
                      <div className="column">
                        <h3>Actions</h3>
                      </div>
                      <div className="column">
                        <p className="push-down">
                          Restarting the memory-server also clears the memory to
                          allow additional data to be passed between pipeline
                          steps.
                        </p>
                        <div className="push-down">
                          {(() => {
                            if (state.restartingMemoryServer) {
                              return (
                                <p className="push-p push-down">
                                  Restarting in progress...
                                </p>
                              );
                            }
                          })()}

                          <MDCButtonReact
                            disabled={state.restartingMemoryServer}
                            label="Restart memory-server"
                            icon="memory"
                            classNames={["mdc-button--raised push-down"]}
                            onClick={restartMemoryServer}
                            data-test-id="pipeline-settings-configuration-restart-memory-server"
                          />
                        </div>
                      </div>
                      <div className="clear"></div>
                    </div>
                  )}
                </div>
              </CustomTabPanel>
              <CustomTabPanel
                value={tabIndex}
                index={1}
                name="environment-variables"
              >
                {state.environmentVariablesChanged && session && (
                  <div className="warning push-down">
                    <i className="material-icons">warning</i>
                    Note: changes to environment variables require a session
                    restart to take effect.
                  </div>
                )}
                {isReadOnly ? (
                  <EnvVarList
                    value={state.envVariables}
                    readOnly={true}
                    data-test-id="pipeline-read-only"
                  />
                ) : (
                  <>
                    <h3 className="push-down">Project environment variables</h3>
                    <EnvVarList
                      value={state.projectEnvVariables}
                      readOnly={true}
                      data-test-id="project-read-only"
                    />

                    <h3 className="push-down">
                      Pipeline environment variables
                    </h3>
                    <p className="push-down">
                      Pipeline environment variables take precedence over
                      project environment variables.
                    </p>
                    <EnvVarList
                      value={state.envVariables}
                      onAdd={addEnvVariablePair}
                      onChange={(e, idx, type) =>
                        onEnvVariablesChange(e, idx, type)
                      }
                      onDelete={(idx) => onEnvVariablesDeletion(idx)}
                      data-test-id="pipeline"
                    />
                  </>
                )}
              </CustomTabPanel>
              <CustomTabPanel value={tabIndex} index={2} name="services">
                <Box css={{ "> * + *": { marginTop: "$4" } }}>
                  {servicesChanged && session && (
                    <div className="warning push-up">
                      <i className="material-icons">warning</i>
                      Note: changes to services require a session restart to
                      take effect.
                    </div>
                  )}
                  <DataTable<ServiceRow>
                    hideSearch
                    id="service-list"
                    columns={columns}
                    rows={serviceRows}
                  />
                  <Alert status="info">
                    <AlertHeader>
                      <IconLightBulbOutline />
                      Want to start using Services?
                    </AlertHeader>
                    <AlertDescription>
                      <Link
                        target="_blank"
                        href="https://docs.orchest.io/en/stable/user_guide/services.html"
                        rel="noopener noreferrer"
                      >
                        Learn more
                      </Link>{" "}
                      about how to expand your pipeline’s capabilities.
                    </AlertDescription>
                  </Alert>
                  {!isReadOnly && (
                    <ServiceTemplatesDialog
                      onSelection={(template) =>
                        addServiceFromTemplate(template)
                      }
                    />
                  )}
                </Box>
              </CustomTabPanel>
            </div>
            <div className="top-buttons">
              <MDCButtonReact
                classNames={["close-button"]}
                icon="close"
                onClick={closeSettings}
                data-test-id="pipeline-settings-close"
              />
            </div>
            {!isReadOnly && (
              <div className="bottom-buttons observe-overflow">
                <MDCButtonReact
                  label={hasUnsavedChanges ? "SAVE*" : "SAVE"}
                  classNames={["mdc-button--raised", "themed-secondary"]}
                  onClick={saveGeneralForm}
                  icon="save"
                  data-test-id="pipeline-settings-save"
                />
              </div>
            )}
          </div>
        ) : (
          <LinearProgress />
        )}
      </div>
    </Layout>
  );
};

export default PipelineSettingsView;
