// @ts-nocheck
import React, { useRef, useEffect, useState } from "react";
import io from "socket.io-client";
import _ from "lodash";

import {
  uuidv4,
  intersectRect,
  collapseDoubleDots,
  makeRequest,
  makeCancelable,
  PromiseManager,
  RefManager,
  activeElementIsInput,
} from "@orchest/lib-utils";
import { MDCButtonReact } from "@orchest/lib-mdc";
import type { TViewPropsWithRequiredQueryArgs } from "@/types";
import { OrchestSessionsConsumer, useOrchest } from "@/hooks/orchest";
import {
  checkGate,
  getScrollLineHeight,
  getPipelineJSONEndpoint,
  serverTimeToDate,
  getServiceURLs,
  filterServices,
  validatePipeline,
} from "@/utils/webserver-utils";

import { Layout } from "@/components/Layout";
import PipelineSettingsView from "@/views/PipelineSettingsView";
import FilePreviewView from "@/views/FilePreviewView";
import JobView from "@/views/JobView";
import JupyterLabView from "@/views/JupyterLabView";
import PipelinesView from "@/views/PipelinesView";
import ProjectsView from "@/views/ProjectsView";

import LogsView from "./LogsView";
import PipelineConnection from "./PipelineConnection";
import PipelineDetails from "./PipelineDetails";
import PipelineStep from "./PipelineStep";
import { Rectangle, getStepSelectorRectangle } from "./Rectangle";

import { useHotKey } from "./hooks/useHotKey";

const STATUS_POLL_FREQUENCY = 1000;
const DRAG_CLICK_SENSITIVITY = 3;
const CANVAS_VIEW_MULTIPLE = 3;
const DOUBLE_CLICK_TIMEOUT = 300;
const INITIAL_PIPELINE_POSITION = [-1, -1];
const DEFAULT_SCALE_FACTOR = 1;

type IPipelineViewProps = TViewPropsWithRequiredQueryArgs<
  "pipeline_uuid" | "project_uuid"
>;

// utility functions that don't need to reside in the component

const areQueryArgsValid = (queryArgs: {
  pipeline_uuid?: string;
  project_uuid?: string;
  [key: string]: any;
}) => {
  return (
    queryArgs.pipeline_uuid !== undefined &&
    queryArgs.project_uuid !== undefined
  );
};

const PipelineView: React.FC<IPipelineViewProps> = (props) => {
  const { $, orchest } = window;
  const { get, state: orchestState, dispatch } = useOrchest();
  const session = get.session(props.queryArgs);

  const [enableSelectAllHotkey, disableSelectAllHotkey] = useHotKey(
    "ctrl+a, command+a",
    "pipeline-editor",
    () => {
      state.eventVars.selectedSteps = Object.keys(state.steps);
      updateEventVars();
    }
  );

  const [enableRunStepsHotkey, disableRunStepsHotkey] = useHotKey(
    "ctrl+enter, command+enter",
    "pipeline-editor",
    () => {
      runSelectedSteps();
    }
  );

  // useEffect(() => {
  //   enableSelectAllHotkey();
  //   enableRunStepsHotkey();
  // }, []);

  const timersRef = useRef({
    pipelineStepStatusPollingInterval: undefined,
    doubleClickTimeout: undefined,
    saveIndicatorTimeout: undefined,
  });

  let initialState = {
    // eventVars are variables that are updated immediately because
    // they are part of a parent object that's passed by reference
    // and never updated. This make it possible to implement
    // complex event based UI logic with jQuery events without
    // having to deal with React state batch update logic.
    // Note: we might replace jQuery for complex event handling
    // like this in the future by using React events exclusively.
    eventVars: {
      keysDown: {},
      mouseClientX: 0,
      mouseClientY: 0,
      prevPosition: [],
      doubleClickFirstClick: false,
      isDeletingStep: false,
      selectedConnection: undefined,
      selectedItem: undefined,
      newConnection: undefined,
      draggingPipeline: false,
      openedStep: undefined,
      openedMultistep: undefined,
      selectedSteps: [],
      showServices: false,
      stepSelector: {
        active: false,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
      },
      scaleFactor: DEFAULT_SCALE_FACTOR,
      connections: [],
    },
    // rendering state
    pipelineOrigin: [0, 0],
    pipelineStepsHolderOffsetLeft: 0,
    pipelineStepsHolderOffsetTop: 0,
    pipelineOffset: [
      INITIAL_PIPELINE_POSITION[0],
      INITIAL_PIPELINE_POSITION[1],
    ],
    // misc. state
    sio: undefined,
    currentOngoingSaves: 0,
    initializedPipeline: false,
    promiseManager: new PromiseManager(),
    refManager: new RefManager(),
    runStatusEndpoint: "/catch/api-proxy/api/runs/",
    pipelineRunning: false,
    waitingOnCancel: false,
    runUUID: undefined,
    pendingRunUUIDs: undefined,
    pendingRunType: undefined,
    stepExecutionState: {},
    steps: {},
    defaultDetailViewIndex: 0,
    shouldAutoStart: false,
    // The save hash is used to propagate a save's side-effects
    // to components.
    saveHash: undefined,
  };

  if (props.queryArgs.run_uuid && props.queryArgs.job_uuid) {
    initialState.runUUID = props.queryArgs.run_uuid;
    initialState.runStatusEndpoint =
      "/catch/api-proxy/api/jobs/" + props.queryArgs.job_uuid + "/";
  }

  const [state, _setState] = React.useState(initialState);
  // TODO: clean up this class-component-stye setState
  const setState = (newState) => {
    _setState((prevState) => {
      let updatedState;
      if (newState instanceof Function) {
        updatedState = newState(prevState);
      } else {
        updatedState = newState;
      }
      return {
        ...prevState,
        ...updatedState,
      };
    });
  };

  const loadViewInEdit = () => {
    let newProps: Record<string, any> = { ...props };
    newProps.queryArgs.read_only = "false";
    newProps.key = uuidv4();
    // open in non-read only
    orchest.loadView(PipelineView, newProps);
  };

  const fetchActivePipelineRuns = () => {
    let pipelineRunsPromise = makeCancelable(
      makeRequest(
        "GET",
        `/catch/api-proxy/api/runs/?project_uuid=${props.queryArgs.project_uuid}&pipeline_uuid=${props.queryArgs.pipeline_uuid}`
      ),
      state.promiseManager
    );

    pipelineRunsPromise.promise
      .then((response) => {
        let data = JSON.parse(response);

        try {
          // Note that runs are returned by the orchest-api by
          // started_time DESC. So we can just retrieve the first run.
          if (data["runs"].length > 0) {
            let run = data["runs"][0];

            setState({
              runUUID: run.uuid,
            });
          }
        } catch (e) {
          console.log("Error parsing return from orchest-api " + e);
        }
      })
      .catch((error) => {
        if (!error.isCanceled) {
          console.error(error);
        }
      });
  };

  const savePipeline = (callback) => {
    if (props.queryArgs.read_only !== "true") {
      let pipelineJSON = encodeJSON();

      // validate pipelineJSON
      let pipelineValidation = validatePipeline(pipelineJSON);

      // if invalid
      if (pipelineValidation.valid !== true) {
        // Just show the first error
        orchest.alert("Error", pipelineValidation.errors[0]);
      } else {
        // store pipeline.json
        let formData = new FormData();
        formData.append("pipeline_json", JSON.stringify(pipelineJSON));

        setState((state) => {
          return {
            currentOngoingSaves: state.currentOngoingSaves + 1,
          };
        });

        clearTimeout(timersRef.current.saveIndicatorTimeout);
        timersRef.current.saveIndicatorTimeout = setTimeout(() => {
          dispatch({
            type: "pipelineSetSaveStatus",
            payload: "saving",
          });
        }, 100);

        // perform POST to save
        let savePromise = makeCancelable(
          makeRequest(
            "POST",
            `/async/pipelines/json/${props.queryArgs.project_uuid}/${props.queryArgs.pipeline_uuid}`,
            { type: "FormData", content: formData }
          ),
          state.promiseManager
        );

        savePromise.promise
          .then(() => {
            if (callback && typeof callback == "function") {
              callback();
            }
            decrementSaveCounter();
          })
          .catch((reason) => {
            if (!reason.isCanceled) {
              decrementSaveCounter();
            }
          });
      }
    } else {
      console.error("savePipeline should be uncallable in readOnly mode.");
    }
  };

  const decrementSaveCounter = () => {
    setState((state) => {
      return {
        currentOngoingSaves: state.currentOngoingSaves - 1,
      };
    });
  };

  const encodeJSON = () => {
    // generate JSON representation using the internal state of React components
    // describing the pipeline

    let pipelineJSON = _.cloneDeep(state.pipelineJson);
    pipelineJSON["steps"] = {};

    for (let key in state.steps) {
      if (state.steps.hasOwnProperty(key)) {
        // deep copy step
        let step = _.cloneDeep(state.steps[key]);

        // remove private meta_data (prefixed with underscore)
        let keys = Object.keys(step.meta_data);
        for (let x = 0; x < keys.length; x++) {
          let key = keys[x];
          if (key[0] === "_") {
            delete step.meta_data[key];
          }
        }

        // we do not encode outgoing connections explicitly according to
        // pipeline.json spec.
        if (step["outgoing_connections"]) {
          delete step["outgoing_connections"];
        }

        pipelineJSON["steps"][step.uuid] = step;
      }
    }

    return pipelineJSON;
  };

  const decodeJSON = (pipelineJson) => {
    // initialize React components based on incoming JSON description of the pipeline

    // add steps to the state
    let { steps } = state;

    for (let key in pipelineJson.steps) {
      if (pipelineJson.steps.hasOwnProperty(key)) {
        steps[key] = pipelineJson.steps[key];

        // augmenting state with runtime data in meta_data
        steps[key].meta_data._drag_count = 0;
        steps[key].meta_data._dragged = false;
      }
    }

    // in addition to creating steps explicitly in the React state, also attach full pipelineJson
    setState({ steps: steps, pipelineJson: pipelineJson });

    return pipelineJson;
  };

  const getPipelineJSON = () => {
    let { steps } = state;
    return { ...state.pipelineJson, steps };
  };

  const openSettings = (initial_tab) => {
    let queryArgs = {
      project_uuid: props.queryArgs.project_uuid,
      pipeline_uuid: props.queryArgs.pipeline_uuid,
      read_only: props.queryArgs.read_only,
      job_uuid: props.queryArgs.job_uuid,
      run_uuid: props.queryArgs.run_uuid,
    };

    if (initial_tab) {
      queryArgs.initial_tab = initial_tab;
    }

    orchest.loadView(PipelineSettingsView, {
      queryArgs,
    });
  };

  const openLogs = () => {
    orchest.loadView(LogsView, {
      queryArgs: {
        project_uuid: props.queryArgs.project_uuid,
        pipeline_uuid: props.queryArgs.pipeline_uuid,
        read_only: props.queryArgs.read_only,
        job_uuid: props.queryArgs.job_uuid,
        run_uuid: props.queryArgs.run_uuid,
      },
    });
  };

  const showServices = () => {
    if (!state.eventVars.showServices) {
      state.eventVars.showServices = true;
      updateEventVars();
    }
  };

  const hideServices = () => {
    if (state.eventVars.showServices) {
      state.eventVars.showServices = false;
      updateEventVars();
    }
  };

  const loadDefaultPipeline = () => {
    // Fetch this project's pipeline
    orchest.getProject().then((selectedProject) => {
      if (selectedProject !== undefined) {
        // initialize REST call for pipelines
        let fetchPipelinesPromise = makeCancelable(
          makeRequest("GET", `/async/pipelines/${selectedProject}`),
          state.promiseManager
        );

        fetchPipelinesPromise.promise
          .then((response) => {
            let data = JSON.parse(response);

            if (data.result.length > 0) {
              orchest.loadView(PipelineView, {
                queryArgs: {
                  pipeline_uuid: data.result[0].uuid,
                  project_uuid: selectedProject,
                },
                key: uuidv4(),
              });
            } else {
              orchest.loadView(PipelinesView);
            }
          })
          .catch((e) => {
            console.error(e);
            orchest.loadView(ProjectsView);
          });
      } else {
        orchest.loadView(PipelinesView);
      }
    });
  };

  const handleSession = () => {
    if (!orchestState.sessionsIsLoading) {
      // If session doesn't exist and first load
      if (
        props.queryArgs.read_only !== "true" &&
        state.shouldAutoStart === true &&
        typeof session === "undefined"
      ) {
        dispatch({
          type: "sessionToggle",
          payload: props.queryArgs,
        });
        setState({ shouldAutoStart: false });
        return;
      }

      if (session?.status == "RUNNING" && state.shouldAutoStart === true) {
        setState({ shouldAutoStart: false });
      }

      if (session?.status === "STOPPING") {
        orchest.jupyter.unload();
      }

      if (session?.notebook_server_info) {
        updateJupyterInstance();
      }
    }
  };

  const initializeResizeHandlers = () => {
    $(window).resize(() => {
      pipelineSetHolderSize();
    });
  };

  // TODO: only make state.sio defined after successful
  // connect to avoid .emit()'ing to unconnected
  // sio client (emits aren't buffered).
  const connectSocketIO = () => {
    // disable polling
    setState({
      sio: io.connect("/pty", { transports: ["websocket"] }),
    });
  };

  const disconnectSocketIO = () => {
    if (state.sio) {
      state.sio.disconnect();
    }
  };

  const getConnectionByUUIDs = (startNodeUUID, endNodeUUID) => {
    for (let x = 0; x < state.eventVars.connections.length; x++) {
      if (
        state.eventVars.connections[x].startNodeUUID === startNodeUUID &&
        state.eventVars.connections[x].endNodeUUID === endNodeUUID
      ) {
        return state.eventVars.connections[x];
      }
    }
  };

  const onClickConnection = (e, startNodeUUID, endNodeUUID) => {
    if (e.button === 0 && !state.eventVars.keysDown[32]) {
      if (state.eventVars.selectedConnection) {
        state.eventVars.selectedConnection.selected = false;
      }

      deselectSteps();

      state.eventVars.selectedConnection = getConnectionByUUIDs(
        startNodeUUID,
        endNodeUUID
      );
      state.eventVars.selectedConnection.selected = true;
      updateEventVars();
    }
  };

  const createConnection = (outgoingJEl, incomingJEl) => {
    let newConnection = {
      startNode: outgoingJEl,
      endNode: incomingJEl,
      xEnd: undefined,
      yEnd: undefined,
      startNodeUUID: outgoingJEl.parents(".pipeline-step").attr("data-uuid"),
      pipelineViewEl: state.refManager.refs.pipelineStepsHolder,
      selected: false,
    };

    if (incomingJEl) {
      newConnection.endNodeUUID = incomingJEl
        .parents(".pipeline-step")
        .attr("data-uuid");
    }

    state.eventVars.connections = state.eventVars.connections.concat([
      newConnection,
    ]);
    updateEventVars();

    if (!incomingJEl) {
      state.eventVars.newConnection = newConnection;
      updateEventVars();
    }
  };

  const willCreateCycle = (startNodeUUID, endNodeUUID) => {
    // add connection temporarily
    let insertIndex =
      state.steps[endNodeUUID].incoming_connections.push(startNodeUUID) - 1;

    // augment incoming_connections with outgoing_connections to be able to traverse from root nodes

    // reset outgoing_connections state (creates 2N algorithm, but makes for guaranteerd clean state.steps data structure)
    for (let step_uuid in state.steps) {
      if (state.steps.hasOwnProperty(step_uuid)) {
        state.steps[step_uuid].outgoing_connections = [];
      }
    }

    for (let step_uuid in state.steps) {
      if (state.steps.hasOwnProperty(step_uuid)) {
        let incoming_connections = state.steps[step_uuid].incoming_connections;
        for (let x = 0; x < incoming_connections.length; x++) {
          state.steps[incoming_connections[x]].outgoing_connections.push(
            step_uuid
          );
        }
      }
    }

    let whiteSet = new Set(Object.keys(state.steps));
    let greySet = new Set();

    let cycles = false;

    while (whiteSet.size > 0) {
      // take first element left in whiteSet
      let step_uuid = whiteSet.values().next().value;

      if (dfsWithSets(step_uuid, whiteSet, greySet)) {
        cycles = true;
      }
    }

    // remote temp connection
    state.steps[endNodeUUID].incoming_connections.splice(insertIndex, 1);

    return cycles;
  };

  const dfsWithSets = (step_uuid, whiteSet, greySet) => {
    // move from white to grey
    whiteSet.delete(step_uuid);
    greySet.add(step_uuid);

    for (
      let x = 0;
      x < state.steps[step_uuid].outgoing_connections.length;
      x++
    ) {
      let child_uuid = state.steps[step_uuid].outgoing_connections[x];

      if (whiteSet.has(child_uuid)) {
        if (dfsWithSets(child_uuid, whiteSet, greySet)) {
          return true;
        }
      } else if (greySet.has(child_uuid)) {
        return true;
      }
    }

    // move from grey to black
    greySet.delete(step_uuid);
  };

  const removeConnection = (connection) => {
    setState((state) => {
      state.eventVars.connections.splice(
        state.eventVars.connections.indexOf(connection),
        1
      );
      updateEventVars();
    });

    if (connection.endNodeUUID) {
      onRemoveConnection(connection.startNodeUUID, connection.endNodeUUID);
    }
  };

  const initializePipelineEditListeners = () => {
    $(document).on("mouseup.initializePipeline", (e) => {
      if (state.eventVars.newConnection) {
        let endNodeUUID = $(e.target)
          .parents(".pipeline-step")
          .attr("data-uuid");
        let startNodeUUID = state.eventVars.newConnection.startNode
          .parents(".pipeline-step")
          .attr("data-uuid");

        // check whether drag release was on .incomming-connections class

        let dragEndedInIcomingConnectionsElement = $(e.target).hasClass(
          "incoming-connections"
        );
        let noConnectionExists = true;

        // check whether there already exists a connection
        if (dragEndedInIcomingConnectionsElement) {
          noConnectionExists =
            state.refManager.refs[
              endNodeUUID
            ].props.step.incoming_connections.indexOf(startNodeUUID) === -1;
        }

        // check whether connection will create a cycle in Pipeline graph
        let connectionCreatesCycle = false;
        if (noConnectionExists && dragEndedInIcomingConnectionsElement) {
          connectionCreatesCycle = willCreateCycle(startNodeUUID, endNodeUUID);
        }

        if (connectionCreatesCycle) {
          orchest.alert(
            "Error",
            "Connecting this step will create a cycle in your pipeline which is not supported."
          );
        }

        if (
          dragEndedInIcomingConnectionsElement &&
          noConnectionExists &&
          !connectionCreatesCycle
        ) {
          state.eventVars.newConnection.endNode = $(e.target);
          state.eventVars.newConnection.endNodeUUID = endNodeUUID;

          updateEventVars();

          state.refManager.refs[endNodeUUID].props.onConnect(
            startNodeUUID,
            endNodeUUID
          );
        } else {
          removeConnection(state.eventVars.newConnection);

          if (!noConnectionExists) {
            orchest.alert(
              "Error",
              "These steps are already connected. No new connection has been created."
            );
          }
        }

        // clean up hover effects

        $(".incoming-connections").removeClass("hover");
      }

      if (state.eventVars.newConnection !== undefined) {
        state.eventVars.newConnection = undefined;
        updateEventVars();
      }

      // clean up creating-connection class
      $(".pipeline-step").removeClass("creating-connection");
    });

    $(state.refManager.refs.pipelineStepsHolder).on(
      "mousedown",
      ".pipeline-step .outgoing-connections",
      (e) => {
        if (e.button === 0) {
          $(e.target).parents(".pipeline-step").addClass("creating-connection");
          // create connection
          createConnection($(e.target));
        }
      }
    );

    $(document).on("keydown.initializePipeline", (e) => {
      if (
        !state.eventVars.isDeletingStep &&
        !activeElementIsInput() &&
        (e.keyCode === 8 || e.keyCode === 46)
      ) {
        // Make sure that successively pressing backspace does not trigger
        // another delete.

        deleteSelectedSteps();
      }
    });

    $(document).on("keyup.initializePipeline", (e) => {
      if (!activeElementIsInput() && (e.keyCode === 8 || e.keyCode === 46)) {
        if (state.eventVars.selectedConnection) {
          e.preventDefault();

          removeConnection(state.eventVars.selectedConnection);
        }
      }
    });

    $(state.refManager.refs.pipelineStepsOuterHolder).on("mousemove", (e) => {
      if (state.eventVars.selectedItem !== undefined) {
        let delta = [
          scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor) -
            state.eventVars.prevPosition[0],
          scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor) -
            state.eventVars.prevPosition[1],
        ];

        state.eventVars.prevPosition = [
          scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor),
          scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor),
        ];

        let step = state.steps[state.eventVars.selectedItem];

        step.meta_data._drag_count++;
        if (step.meta_data._drag_count >= DRAG_CLICK_SENSITIVITY) {
          step.meta_data._dragged = true;
          step.meta_data._drag_count = 0;
        }

        // check for spacebar
        if (!state.eventVars.draggingPipeline) {
          if (
            state.eventVars.selectedSteps.length > 1 &&
            state.eventVars.selectedSteps.indexOf(
              state.eventVars.selectedItem
            ) !== -1
          ) {
            for (let key in state.eventVars.selectedSteps) {
              let uuid = state.eventVars.selectedSteps[key];

              let singleStep = state.steps[uuid];

              singleStep.meta_data.position[0] += delta[0];
              singleStep.meta_data.position[1] += delta[1];

              state.refManager.refs[uuid].updatePosition(
                singleStep.meta_data.position
              );
            }
          } else if (state.eventVars.selectedItem !== undefined) {
            step.meta_data.position[0] += delta[0];
            step.meta_data.position[1] += delta[1];

            state.refManager.refs[step.uuid].updatePosition(
              step.meta_data.position
            );
          }

          // Update connections state
          updateConnectionPosition();
        }
      } else if (state.eventVars.newConnection) {
        let pipelineStepHolderOffset = $(
          state.refManager.refs.pipelineStepsHolder
        ).offset();

        state.eventVars.newConnection.xEnd =
          scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor) -
          scaleCorrectedPosition(
            pipelineStepHolderOffset.left,
            state.eventVars.scaleFactor
          );
        state.eventVars.newConnection.yEnd =
          scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor) -
          scaleCorrectedPosition(
            pipelineStepHolderOffset.top,
            state.eventVars.scaleFactor
          );

        updateEventVars();

        // check for hovering over incoming-connections div
        if ($(e.target).hasClass("incoming-connections")) {
          $(e.target).addClass("hover");
        } else {
          $(".incoming-connections").removeClass("hover");
        }
      }
    });
  };

  const updateConnectionPosition = () => {
    updateEventVars();
  };

  const initializePipelineNavigationListeners = () => {
    $(state.refManager.refs.pipelineStepsHolder).on(
      "mousedown",
      ".pipeline-step",
      (e) => {
        if (e.button === 0) {
          if (!$(e.target).hasClass("outgoing-connections")) {
            let stepUUID = $(e.currentTarget).attr("data-uuid");
            state.eventVars.selectedItem = stepUUID;
            updateEventVars();
          }
        }
      }
    );

    $(document).on("mouseup.initializePipeline", (e) => {
      let stepClicked = false;
      let stepDragged = false;

      if (state.eventVars.selectedItem !== undefined) {
        let step = state.steps[state.eventVars.selectedItem];

        if (!step.meta_data._dragged) {
          if (state.eventVars.selectedConnection) {
            deselectConnection();
          }

          if (!e.ctrlKey) {
            stepClicked = true;

            if (state.eventVars.doubleClickFirstClick) {
              state.refManager.refs[
                state.eventVars.selectedItem
              ].props.onDoubleClick(state.eventVars.selectedItem);
            } else {
              state.refManager.refs[state.eventVars.selectedItem].props.onClick(
                state.eventVars.selectedItem
              );
            }

            state.eventVars.doubleClickFirstClick = true;
            clearTimeout(timersRef.current.doubleClickTimeout);
            timersRef.current.doubleClickTimeout = setTimeout(() => {
              state.eventVars.doubleClickFirstClick = false;
            }, DOUBLE_CLICK_TIMEOUT);
          } else {
            // if clicked step is not selected, select it on Ctrl+Mouseup
            if (
              state.eventVars.selectedSteps.indexOf(
                state.eventVars.selectedItem
              ) === -1
            ) {
              state.eventVars.selectedSteps = state.eventVars.selectedSteps.concat(
                state.eventVars.selectedItem
              );

              updateEventVars();
            } else {
              // remove from selection
              state.eventVars.selectedSteps.splice(
                state.eventVars.selectedSteps.indexOf(
                  state.eventVars.selectedItem
                ),
                1
              );
              updateEventVars();
            }
          }
        } else {
          stepDragged = true;
        }

        step.meta_data._dragged = false;
        step.meta_data._drag_count = 0;
      }

      // check if step needs to be selected based on selectedSteps
      if (
        state.eventVars.stepSelector.active ||
        state.eventVars.selectedItem !== undefined
      ) {
        if (state.eventVars.selectedConnection) {
          deselectConnection();
        }

        if (
          state.eventVars.selectedSteps.length == 1 &&
          !stepClicked &&
          !stepDragged
        ) {
          selectStep(state.eventVars.selectedSteps[0]);
        } else if (state.eventVars.selectedSteps.length > 1 && !stepDragged) {
          // make sure single step detail view is closed
          closeDetailsView();

          // show multistep view
          state.eventVars.openedMultistep = true;
          updateEventVars();
        } else if (!stepDragged) {
          deselectSteps();
        }
      }

      // handle step selector
      if (state.eventVars.stepSelector.active) {
        // on mouse up trigger onClick if single step is selected
        // (only if not triggered by clickEnd)
        state.eventVars.stepSelector.active = false;
        updateEventVars();
      }

      if (stepDragged) {
        setState({
          saveHash: uuidv4(),
        });
      }

      if (e.button === 0 && state.eventVars.selectedSteps.length == 0) {
        // when space bar is held make sure deselection does not occur
        // on click (as it is a drag event)

        if (
          (e.target === state.refManager.refs.pipelineStepsOuterHolder ||
            e.target === state.refManager.refs.pipelineStepsHolder) &&
          state.eventVars.draggingPipeline !== true
        ) {
          if (state.eventVars.selectedConnection) {
            deselectConnection();
          }

          deselectSteps();
        }
      }
      if (state.eventVars.selectedItem !== undefined) {
        state.eventVars.selectedItem = undefined;
        updateEventVars();
      }

      if (state.eventVars.draggingPipeline) {
        state.eventVars.draggingPipeline = false;
        updateEventVars();
      }
    });

    $(state.refManager.refs.pipelineStepsHolder).on("mousedown", (e) => {
      state.eventVars.prevPosition = [
        scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor),
        scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor),
      ];
    });

    $(document).on("mousedown.initializePipeline", (e) => {
      const serviceClass = "services-status";
      if (
        $(e.target).parents("." + serviceClass).length == 0 &&
        !$(e.target).hasClass(serviceClass)
      ) {
        hideServices();
      }
    });

    $(document).on("keydown.initializePipeline", (e) => {
      if (e.keyCode == 72 && !activeElementIsInput()) {
        centerView();
      }

      state.eventVars.keysDown[e.keyCode] = true;
    });

    $(document).on("keyup.initializePipeline", (e) => {
      state.eventVars.keysDown[e.keyCode] = false;

      if (e.keyCode) {
        $(state.refManager.refs.pipelineStepsOuterHolder).removeClass(
          "dragging"
        );

        state.eventVars.draggingPipeline = false;
        updateEventVars();
      }

      if (e.keyCode === 27) {
        if (state.eventVars.selectedConnection) {
          deselectConnection();
        }

        deselectSteps();
        closeDetailsView();
        hideServices();
      }
    });
  };

  const initializePipeline = () => {
    // Initialize should be called only once
    // state.steps is assumed to be populated
    // called after render, assumed dom elements are also available
    // (required by i.e. connections)

    pipelineSetHolderSize();

    if (state.initializedPipeline) {
      console.error("PipelineView component should only be initialized once.");
      return;
    } else {
      setState({
        initializedPipeline: true,
      });
    }

    // add all existing connections (this happens only at initialization)
    for (let key in state.steps) {
      if (state.steps.hasOwnProperty(key)) {
        let step = state.steps[key];

        for (let x = 0; x < step.incoming_connections.length; x++) {
          let startNodeUUID = step.incoming_connections[x];
          let endNodeUUID = step.uuid;

          let startNodeOutgoingEl = $(
            state.refManager.refs.pipelineStepsHolder
          ).find(
            ".pipeline-step[data-uuid='" +
              startNodeUUID +
              "'] .outgoing-connections"
          );

          let endNodeIncomingEl = $(
            state.refManager.refs.pipelineStepsHolder
          ).find(
            ".pipeline-step[data-uuid='" +
              endNodeUUID +
              "'] .incoming-connections"
          );

          if (startNodeOutgoingEl.length > 0 && endNodeIncomingEl.length > 0) {
            createConnection(startNodeOutgoingEl, endNodeIncomingEl);
          }
        }
      }
    }

    // initialize all listeners related to viewing/navigating the pipeline
    initializePipelineNavigationListeners();

    if (props.queryArgs.read_only !== "true") {
      // initialize all listeners related to editing the pipeline
      initializePipelineEditListeners();
    }
  };

  const fetchPipelineAndInitialize = () => {
    let promises = [];
    let pipelineJSONEndpoint = getPipelineJSONEndpoint(
      props.queryArgs.pipeline_uuid,
      props.queryArgs.project_uuid,
      props.queryArgs.job_uuid,
      props.queryArgs.run_uuid
    );

    if (props.queryArgs.read_only !== "true") {
      // fetch pipeline cwd
      let cwdFetchPromise = makeCancelable(
        makeRequest(
          "GET",
          `/async/file-picker-tree/pipeline-cwd/${props.queryArgs.project_uuid}/${props.queryArgs.pipeline_uuid}`
        ),
        state.promiseManager
      );
      promises.push(cwdFetchPromise.promise);

      cwdFetchPromise.promise
        .then((cwdPromiseResult) => {
          // relativeToAbsolutePath expects trailing / for directories
          let cwd = JSON.parse(cwdPromiseResult)["cwd"] + "/";
          setState({
            pipelineCwd: cwd,
          });
        })
        .catch((error) => {
          if (!error.isCanceled) {
            console.error(error);
          }
        });
    }

    let fetchPipelinePromise = makeCancelable(
      makeRequest("GET", pipelineJSONEndpoint),
      state.promiseManager
    );
    promises.push(fetchPipelinePromise.promise);

    fetchPipelinePromise.promise
      .then((fetchPipelinePromiseResult) => {
        let result = JSON.parse(fetchPipelinePromiseResult);
        if (result.success) {
          let pipelineJson = decodeJSON(JSON.parse(result["pipeline_json"]));

          dispatch({
            type: "pipelineUpdateReadOnlyState",
            payload: props.queryArgs.read_only === "true",
          });

          dispatch({
            type: "pipelineSet",
            payload: {
              pipeline_uuid: props.queryArgs.pipeline_uuid,
              project_uuid: props.queryArgs.project_uuid,
              pipelineName: pipelineJson.name,
            },
          });
        } else {
          console.error("Could not load pipeline.json");
          console.error(result);
        }
      })
      .catch((error) => {
        if (!error.isCanceled) {
          if (props.queryArgs.job_uuid) {
            // This case is hit when a user tries to load a pipeline that belongs
            // to a run that has not started yet. The project files are only
            // copied when the run starts. Before start, the pipeline.json thus
            // cannot be found. Alert the user about missing pipeline and return
            // to JobView.

            orchest.alert(
              "Error",
              "The .orchest pipeline file could not be found. This pipeline run has not been started. Returning to Job view.",
              () => {
                orchest.loadView(JobView, {
                  queryArgs: {
                    job_uuid: props.queryArgs.job_uuid,
                  },
                });
              }
            );
          } else {
            console.error("Could not load pipeline.json");
            console.error(error);
          }
        }
      });

    Promise.all(promises)
      .then(() => {
        initializePipeline();
      })
      .catch((error) => {
        console.error(error);
      });
  };

  const updateJupyterInstance = () => {
    const base_url = session?.notebook_server_info?.base_url;

    if (base_url) {
      let baseAddress = "//" + window.location.host + base_url;
      orchest.jupyter.updateJupyterInstance(baseAddress);
    }
  };

  const newStep = () => {
    deselectSteps();

    let environmentsEndpoint = `/store/environments/${props.queryArgs.project_uuid}`;
    let fetchEnvironmentsPromise = makeCancelable(
      makeRequest("GET", environmentsEndpoint),
      state.promiseManager
    );

    fetchEnvironmentsPromise.promise.then((response) => {
      let result = JSON.parse(response);

      let environmentUUID = "";
      let environmentName = "";

      if (result.length > 0) {
        environmentUUID = result[0].uuid;
        environmentName = result[0].name;
      }

      let step = {
        title: "",
        uuid: uuidv4(),
        incoming_connections: [],
        file_path: "",
        kernel: {
          name: "python",
          display_name: environmentName,
        },
        environment: environmentUUID,
        parameters: {},
        meta_data: {
          position: [0, 0],
          _dragged: false,
          _drag_count: 0,
          hidden: true,
        },
      };

      state.steps[step.uuid] = step;
      setState({ steps: state.steps });

      selectStep(step.uuid);

      // wait for single render call
      setTimeout(() => {
        // Assumes step.uuid doesn't change
        let _step = state.steps[step.uuid];

        _step["meta_data"]["position"] = [
          -state.pipelineOffset[0] +
            state.refManager.refs.pipelineStepsOuterHolder.clientWidth / 2 -
            190 / 2,
          -state.pipelineOffset[1] +
            state.refManager.refs.pipelineStepsOuterHolder.clientHeight / 2 -
            105 / 2,
        ];

        // to avoid repositioning flash (creating a step can affect the size of the viewport)
        _step["meta_data"]["hidden"] = false;

        setState({ steps: state.steps, saveHash: uuidv4() });
        state.refManager.refs[step.uuid].updatePosition(
          state.steps[step.uuid].meta_data.position
        );
      }, 0);
    });
  };

  const selectStep = (pipelineStepUUID: string) => {
    state.eventVars.openedStep = pipelineStepUUID;
    state.eventVars.selectedSteps = [pipelineStepUUID];
    updateEventVars();
  };

  const onClickStepHandler = (stepUUID: string) => {
    setTimeout(() => {
      selectStep(stepUUID);
    });
  };

  const onDoubleClickStepHandler = (stepUUID: string) => {
    if (props.queryArgs.read_only === "true") {
      onOpenFilePreviewView(stepUUID);
    } else {
      openNotebook(stepUUID);
    }
  };

  const makeConnection = (sourcePipelineStepUUID, targetPipelineStepUUID) => {
    if (
      state.steps[targetPipelineStepUUID].incoming_connections.indexOf(
        sourcePipelineStepUUID
      ) === -1
    ) {
      state.steps[targetPipelineStepUUID].incoming_connections.push(
        sourcePipelineStepUUID
      );
    }

    setState((state) => {
      return {
        steps: state.steps,
        saveHash: uuidv4(),
      };
    });
  };

  const getStepExecutionState = (stepUUID) => {
    if (state.stepExecutionState[stepUUID]) {
      return state.stepExecutionState[stepUUID];
    } else {
      return { status: "idle" };
    }
  };

  const setStepExecutionState = (stepUUID, executionState) => {
    state.stepExecutionState[stepUUID] = executionState;

    setState({
      stepExecutionState: state.stepExecutionState,
    });
  };

  const onRemoveConnection = (
    sourcePipelineStepUUID,
    targetPipelineStepUUID
  ) => {
    let connectionIndex = state.steps[
      targetPipelineStepUUID
    ].incoming_connections.indexOf(sourcePipelineStepUUID);
    if (connectionIndex !== -1) {
      state.steps[targetPipelineStepUUID].incoming_connections.splice(
        connectionIndex,
        1
      );
    }

    setState((state) => {
      return {
        steps: state.steps,
        saveHash: uuidv4(),
      };
    });
  };

  const deleteSelectedSteps = () => {
    // The if is to avoid the dialog appearing when no steps are
    // selected and the delete button is pressed.
    if (state.eventVars.selectedSteps.length > 0) {
      state.eventVars.isDeletingStep = true;
      updateEventVars();

      orchest.confirm(
        "Warning",
        "A deleted step and its logs cannot be recovered once deleted, are you" +
          " sure you want to proceed?",
        () => {
          closeMultistepView();
          closeDetailsView();

          // DeleteStep is going to remove the step from state.selected
          // Steps, modifying the collection while we are iterating on it.
          let stepsToRemove = state.eventVars.selectedSteps.slice();
          for (let x = 0; x < stepsToRemove.length; x++) {
            deleteStep(stepsToRemove[x]);
          }

          state.eventVars.selectedSteps = [];
          state.eventVars.isDeletingStep = false;
          updateEventVars();
          setState({
            saveHash: uuidv4(),
          });
        },
        () => {
          state.eventVars.isDeletingStep = false;
          updateEventVars();
        }
      );
    }
  };

  const deleteStep = (uuid) => {
    // also delete incoming connections that contain this uuid
    for (let key in state.steps) {
      if (state.steps.hasOwnProperty(key)) {
        let step = state.steps[key];

        let connectionIndex = step.incoming_connections.indexOf(uuid);
        if (connectionIndex !== -1) {
          // also delete incoming connections from GUI
          let connection = getConnectionByUUIDs(uuid, step.uuid);
          removeConnection(connection);
        }
      }
    }

    // visually delete incoming connections from GUI
    let step = state.steps[uuid];
    let connectionsToRemove = [];

    // removeConnection modifies incoming_connections, hence the double
    // loop.
    for (let x = 0; x < step.incoming_connections.length; x++) {
      connectionsToRemove.push(
        getConnectionByUUIDs(step.incoming_connections[x], uuid)
      );
    }
    for (let connection of connectionsToRemove) {
      removeConnection(connection);
    }

    delete state.steps[uuid];

    // if step is in selectedSteps remove
    let deletedStepIndex = state.eventVars.selectedSteps.indexOf(uuid);
    if (deletedStepIndex >= 0) {
      state.eventVars.selectedSteps.splice(deletedStepIndex, 1);
    }

    updateEventVars();
    setState({
      steps: state.steps,
    });
  };

  const onDetailsDelete = () => {
    let uuid = state.eventVars.openedStep;
    orchest.confirm(
      "Warning",
      "A deleted step and its logs cannot be recovered once deleted, are you" +
        " sure you want to proceed?",
      () => {
        state.eventVars.openedStep = undefined;
        state.eventVars.selectedSteps = [];
        updateEventVars();
        deleteStep(uuid);
        setState({
          saveHash: uuidv4(),
        });
      }
    );
  };

  const updateEventVars = () => {
    setState((state) => {
      return { eventVars: state.eventVars };
    });
  };

  const openNotebook = (stepUUID: string) => {
    if (session === undefined) {
      orchest.alert(
        "Error",
        "Please start the session before opening the Notebook in Jupyter."
      );
    } else if (session.status === "RUNNING") {
      orchest.loadView(JupyterLabView, {
        queryArgs: {
          pipeline_uuid: props.queryArgs.pipeline_uuid,
          project_uuid: props.queryArgs.project_uuid,
        },
      });

      orchest.jupyter.navigateTo(
        collapseDoubleDots(
          state.pipelineCwd + state.steps[stepUUID].file_path
        ).slice(1)
      );
    } else if (session.status === "LAUNCHING") {
      orchest.alert(
        "Error",
        "Please wait for the session to start before opening the Notebook in Jupyter."
      );
    } else {
      orchest.alert(
        "Error",
        "Please start the session before opening the Notebook in Jupyter."
      );
    }
  };

  const onOpenFilePreviewView = (step_uuid) => {
    orchest.loadView(FilePreviewView, {
      queryArgs: {
        project_uuid: props.queryArgs.project_uuid,
        pipeline_uuid: props.queryArgs.pipeline_uuid,
        job_uuid: props.queryArgs.job_uuid,
        run_uuid: props.queryArgs.run_uuid,
        step_uuid: step_uuid,
        read_only: props.queryArgs.read_only,
      },
    });
  };

  const onOpenNotebook = () => {
    openNotebook(state.eventVars.openedStep);
  };

  const parseRunStatuses = (result) => {
    if (
      result.pipeline_steps === undefined ||
      result.pipeline_steps.length === undefined
    ) {
      console.error(
        "Did not contain pipeline_steps list. Invalid `result` object"
      );
    }

    for (let x = 0; x < result.pipeline_steps.length; x++) {
      // finished_time takes priority over started_time
      let started_time = undefined;
      let finished_time = undefined;
      let server_time = serverTimeToDate(result.server_time);

      if (result.pipeline_steps[x].started_time) {
        started_time = serverTimeToDate(result.pipeline_steps[x].started_time);
      }
      if (result.pipeline_steps[x].finished_time) {
        finished_time = serverTimeToDate(
          result.pipeline_steps[x].finished_time
        );
      }

      setStepExecutionState(result.pipeline_steps[x].step_uuid, {
        status: result.pipeline_steps[x].status,
        started_time: started_time,
        finished_time: finished_time,
        server_time: server_time,
      });
    }
  };

  const pollPipelineStepStatuses = () => {
    if (state.runUUID) {
      let pollPromise = makeCancelable(
        makeRequest("GET", state.runStatusEndpoint + state.runUUID),
        state.promiseManager
      );

      pollPromise.promise
        .then((response) => {
          let result = JSON.parse(response);

          parseRunStatuses(result);

          if (["PENDING", "STARTED"].indexOf(result.status) !== -1) {
            setState({
              pipelineRunning: true,
            });
          }

          if (["SUCCESS", "ABORTED", "FAILURE"].includes(result.status)) {
            // make sure stale opened files are reloaded in active
            // Jupyter instance

            orchest.jupyter.reloadFilesFromDisk();

            setState({
              pipelineRunning: false,
              waitingOnCancel: false,
            });
            clearInterval(timersRef.current.pipelineStepStatusPollingInterval);
          }
        })
        .catch((error) => {
          console.warn(error);
        });
    }
  };

  const centerView = () => {
    state.eventVars.scaleFactor = DEFAULT_SCALE_FACTOR;
    updateEventVars();

    setState({
      pipelineOffset: [
        INITIAL_PIPELINE_POSITION[0],
        INITIAL_PIPELINE_POSITION[1],
      ],
      pipelineStepsHolderOffsetLeft: 0,
      pipelineStepsHolderOffsetTop: 0,
    });
  };

  const centerPipelineOrigin = () => {
    let pipelineStepsOuterHolderJ = $(
      state.refManager.refs.pipelineStepsOuterHolder
    );

    let pipelineStepsOuterHolderOffset = $(
      state.refManager.refs.pipelineStepsOuterHolder
    ).offset();

    let pipelineStepsHolderOffset = $(
      state.refManager.refs.pipelineStepsHolder
    ).offset();

    let centerOrigin = [
      scaleCorrectedPosition(
        pipelineStepsOuterHolderOffset.left -
          pipelineStepsHolderOffset.left +
          pipelineStepsOuterHolderJ.width() / 2,
        state.eventVars.scaleFactor
      ),
      scaleCorrectedPosition(
        pipelineStepsOuterHolderOffset.top -
          pipelineStepsHolderOffset.top +
          pipelineStepsOuterHolderJ.height() / 2,
        state.eventVars.scaleFactor
      ),
    ];

    pipelineSetHolderOrigin(centerOrigin);
  };

  const zoomOut = () => {
    centerPipelineOrigin();
    state.eventVars.scaleFactor = Math.max(
      state.eventVars.scaleFactor - 0.25,
      0.25
    );
    updateEventVars();
  };

  const zoomIn = () => {
    centerPipelineOrigin();
    state.eventVars.scaleFactor = Math.min(
      state.eventVars.scaleFactor + 0.25,
      2
    );
    updateEventVars();
  };

  const scaleCorrectedPosition = (position, scaleFactor) => {
    position /= scaleFactor;
    return position;
  };

  const pipelineSetHolderOrigin = (newOrigin) => {
    let pipelineStepsHolderOffset = $(
      state.refManager.refs.pipelineStepsHolder
    ).offset();

    let pipelineStepsOuterHolderOffset = $(
      state.refManager.refs.pipelineStepsOuterHolder
    ).offset();

    let initialX =
      pipelineStepsHolderOffset.left - pipelineStepsOuterHolderOffset.left;
    let initialY =
      pipelineStepsHolderOffset.top - pipelineStepsOuterHolderOffset.top;

    let translateXY = originTransformScaling(
      [...newOrigin],
      state.eventVars.scaleFactor
    );

    setState({
      pipelineOrigin: newOrigin,
      pipelineStepsHolderOffsetLeft:
        translateXY[0] + initialX - state.pipelineOffset[0],
      pipelineStepsHolderOffsetTop:
        translateXY[1] + initialY - state.pipelineOffset[1],
    });
  };

  const onPipelineStepsOuterHolderWheel = (e) => {
    let pipelineMousePosition = getMousePositionRelativeToPipelineStepHolder();

    // set origin at scroll wheel trigger
    if (
      pipelineMousePosition[0] != state.pipelineOrigin[0] ||
      pipelineMousePosition[1] != state.pipelineOrigin[1]
    ) {
      pipelineSetHolderOrigin(pipelineMousePosition);
    }

    /* mouseWheel contains information about the deltaY variable
     * WheelEvent.deltaMode can be:
     * DOM_DELTA_PIXEL = 0x00
     * DOM_DELTA_LINE = 0x01 (only used in Firefox)
     * DOM_DELTA_PAGE = 0x02 (which we'll treat identically to DOM_DELTA_LINE)
     */

    let deltaY = e.nativeEvent.deltaY;
    if (e.nativeEvent.deltaMode == 0x01 || e.nativeEvent.deltaMode == 0x02) {
      deltaY = getScrollLineHeight() * deltaY;
    }

    state.eventVars.scaleFactor = Math.min(
      Math.max(state.eventVars.scaleFactor - deltaY / 3000, 0.25),
      2
    );
    updateEventVars();
  };

  const runSelectedSteps = () => {
    runStepUUIDs(state.eventVars.selectedSteps, "selection");
  };
  const onRunIncoming = () => {
    runStepUUIDs(state.eventVars.selectedSteps, "incoming");
  };

  const cancelRun = () => {
    if (!state.pipelineRunning) {
      orchest.alert("Error", "There is no pipeline running.");
      return;
    }

    ((runUUID) => {
      makeRequest("DELETE", `/catch/api-proxy/api/runs/${runUUID}`)
        .then(() => {
          setState({
            waitingOnCancel: true,
          });
        })
        .catch((response) => {
          orchest.alert(
            "Error",
            `Could not cancel pipeline run for runUUID ${runUUID}`
          );
        });
    })(state.runUUID);
  };

  const _runStepUUIDs = (uuids, type) => {
    setState({
      pipelineRunning: true,
    });

    // store pipeline.json
    let data = {
      uuids: uuids,
      project_uuid: props.queryArgs.project_uuid,
      run_type: type,
      pipeline_definition: getPipelineJSON(),
    };

    let runStepUUIDsPromise = makeCancelable(
      makeRequest("POST", "/catch/api-proxy/api/runs/", {
        type: "json",
        content: data,
      }),
      state.promiseManager
    );

    runStepUUIDsPromise.promise
      .then((response) => {
        let result = JSON.parse(response);

        parseRunStatuses(result);

        setState({
          runUUID: result.uuid,
        });

        startStatusInterval();
      })
      .catch((response) => {
        if (!response.isCanceled) {
          setState({
            pipelineRunning: false,
          });

          try {
            let data = JSON.parse(response.body);
            orchest.alert(
              "Error",
              "Failed to start interactive run. " + data["message"]
            );
          } catch {
            orchest.alert(
              "Error",
              "Failed to start interactive run. Unknown error."
            );
          }
        }
      });
  };

  const runStepUUIDs = (uuids, type) => {
    if (!session || session.status !== "RUNNING") {
      orchest.alert(
        "Error",
        "There is no active session. Please start the session first."
      );
      return;
    }

    if (state.pipelineRunning) {
      orchest.alert(
        "Error",
        "The pipeline is currently executing, please wait until it completes."
      );
      return;
    }

    setState({
      pendingRunUUIDs: uuids,
      pendingRunType: type,
      saveHash: uuidv4(),
    });
  };

  const startStatusInterval = () => {
    // initialize interval
    clearInterval(timersRef.current.pipelineStepStatusPollingInterval);
    timersRef.current.pipelineStepStatusPollingInterval = setInterval(
      pollPipelineStepStatuses,
      STATUS_POLL_FREQUENCY
    );
  };

  const onCloseDetails = () => {
    closeDetailsView();
  };

  const closeDetailsView = () => {
    state.eventVars.openedStep = undefined;
    updateEventVars();
  };

  const closeMultistepView = () => {
    state.eventVars.openedMultistep = undefined;
    updateEventVars();
  };

  const onCloseMultistep = () => {
    closeMultistepView();
  };

  const onDeleteMultistep = () => {
    deleteSelectedSteps();
  };

  const onDetailsChangeView = (newIndex) => {
    setState({
      defaultDetailViewIndex: newIndex,
    });
  };

  const onSaveDetails = (stepChanges, uuid) => {
    // Mutate step with changes
    _.assignIn(state.steps[uuid], stepChanges);

    setState({
      steps: state.steps,
      saveHash: uuidv4(),
    });
  };

  const deselectSteps = () => {
    // deselecting will close the detail view
    closeDetailsView();
    onCloseMultistep();

    state.eventVars.stepSelector.x1 = Number.MIN_VALUE;
    state.eventVars.stepSelector.y1 = Number.MIN_VALUE;
    state.eventVars.stepSelector.x2 = Number.MIN_VALUE;
    state.eventVars.stepSelector.y2 = Number.MIN_VALUE;
    state.eventVars.stepSelector.active = false;

    state.eventVars.selectedSteps = [];
    updateEventVars();
  };

  const deselectConnection = () => {
    state.eventVars.selectedConnection.selected = false;
    state.eventVars.selectedConnection = undefined;
    updateEventVars();
  };

  const getSelectedSteps = () => {
    let rect = getStepSelectorRectangle(state.eventVars.stepSelector);

    let selectedSteps = [];

    // for each step perform intersect
    if (state.eventVars.stepSelector.active) {
      for (let uuid in state.steps) {
        if (state.steps.hasOwnProperty(uuid)) {
          let step = state.steps[uuid];

          // guard against ref existing, in case step is being added
          if (state.refManager.refs[uuid]) {
            let stepDom = $(
              state.refManager.refs[uuid].refManager.refs.container
            );

            let stepRect = {
              x: step.meta_data.position[0],
              y: step.meta_data.position[1],
              width: stepDom.outerWidth(),
              height: stepDom.outerHeight(),
            };

            if (intersectRect(rect, stepRect)) {
              selectedSteps.push(uuid);
            }
          }
        }
      }
    }

    return selectedSteps;
  };

  const pipelineSetHolderSize = () => {
    // TODO: resize canvas based on pipeline size

    let jElStepOuterHolder = $(state.refManager.refs.pipelineStepsOuterHolder);

    if (jElStepOuterHolder.filter(":visible").length > 0) {
      $(state.refManager.refs.pipelineStepsHolder).css({
        width: jElStepOuterHolder.width() * CANVAS_VIEW_MULTIPLE,
        height: jElStepOuterHolder.height() * CANVAS_VIEW_MULTIPLE,
      });
    }
  };

  const getMousePositionRelativeToPipelineStepHolder = () => {
    let pipelineStepsolderOffset = $(
      state.refManager.refs.pipelineStepsHolder
    ).offset();

    return [
      scaleCorrectedPosition(
        state.eventVars.mouseClientX - pipelineStepsolderOffset.left,
        state.eventVars.scaleFactor
      ),
      scaleCorrectedPosition(
        state.eventVars.mouseClientY - pipelineStepsolderOffset.top,
        state.eventVars.scaleFactor
      ),
    ];
  };

  const originTransformScaling = (origin, scaleFactor) => {
    /* By multiplying the transform-origin with the scaleFactor we get the right
     * displacement for the transformed/scaled parent (pipelineStepHolder)
     * that avoids visual displacement when the origin of the
     * transformed/scaled parent is modified.
     *
     * the adjustedScaleFactor was derived by analysing the geometric behavior
     * of applying the css transform: translate(...) scale(...);.
     */

    let adjustedScaleFactor = scaleFactor - 1;
    origin[0] *= adjustedScaleFactor;
    origin[1] *= adjustedScaleFactor;
    return origin;
  };

  const servicesAvailable = () => {
    if (
      (!props.queryArgs.job_uuid && session && session.status == "RUNNING") ||
      (props.queryArgs.job_uuid && state.pipelineJson && state.pipelineRunning)
    ) {
      let services = getServices();
      if (services !== undefined) {
        return Object.keys(services).length > 0;
      } else {
        return false;
      }
    } else {
      return false;
    }
  };

  useEffect(() => {
    const keyDownHandler = (event: KeyboardEvent) => {
      if (event.key === " " && !state.eventVars.draggingPipeline) {
        state.eventVars.keysDown[32] = true;
        $(state.refManager.refs.pipelineStepsOuterHolder)
          .removeClass("dragging")
          .addClass("ready-to-drag");
        updateEventVars();
      }
    };
    const keyUpHandler = (event: KeyboardEvent) => {
      if (event.key === " ") {
        $(state.refManager.refs.pipelineStepsOuterHolder).removeClass([
          "ready-to-drag",
          "dragging",
        ]);
      }
    };

    document.body.addEventListener("keydown", keyDownHandler);
    document.body.addEventListener("keyup", keyUpHandler);
    return () => {
      document.body.removeEventListener("keydown", keyDownHandler);
      document.body.removeEventListener("keyup", keyUpHandler);
    };
  }, []);

  const onMouseOverPipelineView = () => {
    enableSelectAllHotkey();
    enableRunStepsHotkey();
  };

  const disableHotkeys = () => {
    disableSelectAllHotkey();
    disableRunStepsHotkey();
  };

  const onPipelineStepsOuterHolderDown = (e) => {
    state.eventVars.mouseClientX = e.clientX;
    state.eventVars.mouseClientY = e.clientY;

    if (e.button === 0) {
      if (state.eventVars.keysDown[32]) {
        // space held while clicking, means canvas drag

        $(state.refManager.refs.pipelineStepsOuterHolder)
          .addClass("dragging")
          .removeClass("ready-to-drag");
        state.eventVars.draggingPipeline = true;
      }
    }

    if (
      ($(e.target).hasClass("pipeline-steps-holder") ||
        $(e.target).hasClass("pipeline-steps-outer-holder")) &&
      e.button === 0
    ) {
      if (!state.eventVars.draggingPipeline) {
        let pipelineStepHolderOffset = $(".pipeline-steps-holder").offset();

        state.eventVars.stepSelector.active = true;
        state.eventVars.stepSelector.x1 = state.eventVars.stepSelector.x2 =
          scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor) -
          scaleCorrectedPosition(
            pipelineStepHolderOffset.left,
            state.eventVars.scaleFactor
          );
        state.eventVars.stepSelector.y1 = state.eventVars.stepSelector.y2 =
          scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor) -
          scaleCorrectedPosition(
            pipelineStepHolderOffset.top,
            state.eventVars.scaleFactor
          );

        state.eventVars.selectedSteps = getSelectedSteps();
        updateEventVars();
      }
    }

    updateEventVars();
  };

  const onPipelineStepsOuterHolderMove = (e) => {
    if (state.eventVars.stepSelector.active) {
      let pipelineStepHolderOffset = $(
        state.refManager.refs.pipelineStepsHolder
      ).offset();

      state.eventVars.stepSelector.x2 =
        scaleCorrectedPosition(e.clientX, state.eventVars.scaleFactor) -
        scaleCorrectedPosition(
          pipelineStepHolderOffset.left,
          state.eventVars.scaleFactor
        );
      state.eventVars.stepSelector.y2 =
        scaleCorrectedPosition(e.clientY, state.eventVars.scaleFactor) -
        scaleCorrectedPosition(
          pipelineStepHolderOffset.top,
          state.eventVars.scaleFactor
        );

      state.eventVars.selectedSteps = getSelectedSteps();
      updateEventVars();
    }

    if (state.eventVars.draggingPipeline) {
      let dx = e.clientX - state.eventVars.mouseClientX;
      let dy = e.clientY - state.eventVars.mouseClientY;

      setState((state) => {
        return {
          pipelineOffset: [
            state.pipelineOffset[0] + dx,
            state.pipelineOffset[1] + dy,
          ],
        };
      });
    }

    state.eventVars.mouseClientX = e.clientX;
    state.eventVars.mouseClientY = e.clientY;
  };

  const getServices = () => {
    let services;
    if (!props.queryArgs.job_uuid) {
      if (session && session.user_services) {
        services = session.user_services;
      }
    } else {
      services = state.pipelineJson.services;
    }

    // Filter services based on scope
    let scope = props.queryArgs.job_uuid ? "noninteractive" : "interactive";
    return filterServices(services, scope);
  };

  const generateServiceEndpoints = () => {
    let serviceLinks = [];
    let services = getServices();

    for (let serviceName in services) {
      let service = services[serviceName];

      let urls = getServiceURLs(
        service,
        props.queryArgs.project_uuid,
        props.queryArgs.pipeline_uuid,
        props.queryArgs.run_uuid
      );

      let formatUrl = (url) => {
        return "Port " + url.split("/")[3].split("_").slice(-1)[0];
      };

      serviceLinks.push(<h4 key={serviceName}>{serviceName}</h4>);

      for (let url of urls) {
        serviceLinks.push(
          <div className="link-holder" key={url}>
            <a target="_blank" href={url} rel="noreferrer">
              <span className="material-icons">open_in_new</span>{" "}
              {formatUrl(url)}
            </a>
          </div>
        );
      }

      if (urls.length == 0) {
        serviceLinks.push(
          <i key={serviceName + "-i"}>This service has no endpoints.</i>
        );
      }
    }
    return <div>{serviceLinks}</div>;
  };

  const returnToJob = (job_uuid: string) => {
    orchest.loadView(JobView, {
      queryArgs: {
        job_uuid,
      },
    });
  };

  let connections_list = {};
  if (state.eventVars.openedStep) {
    const step = state.steps[state.eventVars.openedStep];
    const { incoming_connections } = step;

    incoming_connections.forEach((id: string) => {
      connections_list[id] = [state.steps[id].title, state.steps[id].file_path];
    });
  }

  // Check if there is an incoming step (that is not part of the
  // selection).
  // This is checked to conditionally render the
  // 'Run incoming steps' button.
  let selectedStepsHasIncoming = false;
  for (let x = 0; x < state.eventVars.selectedSteps.length; x++) {
    let selectedStep = state.steps[state.eventVars.selectedSteps[x]];
    for (let i = 0; i < selectedStep.incoming_connections.length; i++) {
      let incomingStepUUID = selectedStep.incoming_connections[i];
      if (state.eventVars.selectedSteps.indexOf(incomingStepUUID) < 0) {
        selectedStepsHasIncoming = true;
        break;
      }
    }
    if (selectedStepsHasIncoming) {
      break;
    }
  }

  const pipelineSteps = Object.entries(state.steps).map((entry) => {
    const [uuid, step] = entry;
    const selected = state.eventVars.selectedSteps.indexOf(uuid) !== -1;
    // only add steps to the component that have been properly
    // initialized
    return (
      <PipelineStep
        key={step.uuid}
        step={step}
        selected={selected}
        ref={state.refManager.nrefs[step.uuid]}
        executionState={getStepExecutionState(step.uuid)}
        onConnect={makeConnection}
        onClick={onClickStepHandler}
        onDoubleClick={onDoubleClickStepHandler}
      />
    );
  });

  const connectionComponents = state.eventVars.connections.map(
    (connection, index) => {
      return (
        <PipelineConnection
          key={index}
          scaleFactor={state.eventVars.scaleFactor}
          scaleCorrectedPosition={scaleCorrectedPosition}
          onClick={onClickConnection}
          {...connection}
        />
      );
    }
  );

  React.useEffect(() => {
    pollPipelineStepStatuses();
    startStatusInterval();
  }, [state.runUUID]);

  React.useEffect(() => {
    if (state.saveHash !== undefined) {
      if (
        state.pendingRunUUIDs !== undefined &&
        state.pendingRunType !== undefined
      ) {
        let uuids = state.pendingRunUUIDs;
        let runType = state.pendingRunType;
        setState({
          pendingRunUUIDs: undefined,
          pendingRunType: undefined,
        });
        savePipeline(() => {
          _runStepUUIDs(uuids, runType);
        });
      } else {
        savePipeline();
      }
    }
  }, [state.saveHash, state.pendingRunUUIDs, state.pendingRunType]);

  React.useEffect(() => {
    if (state.currentOngoingSaves === 0) {
      clearTimeout(timersRef.current.saveIndicatorTimeout);
      dispatch({
        type: "pipelineSetSaveStatus",
        payload: "saved",
      });
    }
  }, [state.currentOngoingSaves]);

  React.useEffect(() => {
    if (props.queryArgs && props.queryArgs.read_only !== "true") {
      setState({ shouldAutoStart: true });
    } else {
      setState({ shouldAutoStart: false });
    }
  }, [props]);

  React.useEffect(() => {
    dispatch({
      type: "setView",
      payload: "pipeline",
    });

    const { queryArgs } = props;

    if (areQueryArgsValid(queryArgs)) {
      const hasActiveRun = queryArgs.run_uuid && queryArgs.job_uuid;
      if (hasActiveRun) {
        try {
          pollPipelineStepStatuses();
          startStatusInterval();
        } catch (e) {
          console.log("could not start pipeline status updates: " + e);
        }
      }

      const isNonPipelineRun =
        !hasActiveRun && props.queryArgs.read_only === "true";
      if (isNonPipelineRun) {
        // for non pipelineRun - read only check gate
        let checkGatePromise = checkGate(queryArgs.project_uuid);
        checkGatePromise
          .then(() => {
            loadViewInEdit();
          })
          .catch((result) => {
            if (result.reason === "gate-failed") {
              orchest.requestBuild(
                props.queryArgs.project_uuid,
                result.data,
                "Pipeline",
                () => {
                  loadViewInEdit();
                }
              );
            }
          });
      }

      connectSocketIO();
      initializeResizeHandlers();

      // Edit mode fetches latest interactive run
      if (queryArgs.read_only !== "true") {
        fetchActivePipelineRuns();
      }
    } else {
      loadDefaultPipeline();
    }

    return () => {
      dispatch({
        type: "clearView",
      });

      disconnectSocketIO();

      $(document).off("mouseup.initializePipeline");
      $(document).off("mousedown.initializePipeline");
      $(document).off("keyup.initializePipeline");
      $(document).off("keydown.initializePipeline");

      clearInterval(timersRef.current.pipelineStepStatusPollingInterval);
      clearTimeout(timersRef.current.doubleClickTimeout);
      clearTimeout(timersRef.current.saveIndicatorTimeout);

      state.promiseManager.cancelCancelablePromises();
    };
  }, []);

  React.useEffect(() => {
    if (
      state.pipelineOffset[0] == INITIAL_PIPELINE_POSITION[0] &&
      state.pipelineOffset[1] == INITIAL_PIPELINE_POSITION[1] &&
      state.eventVars.scaleFactor == DEFAULT_SCALE_FACTOR
    ) {
      pipelineSetHolderOrigin([0, 0]);
    }
  }, [state.eventVars.scaleFactor, state.pipelineOffset]);

  React.useEffect(() => {
    // fetch pipeline when uuid changed
    fetchPipelineAndInitialize();
  }, [props.queryArgs.pipeline_uuid]);

  React.useEffect(() => {
    handleSession();
  }, [session, state.sessionsIsLoading, props, state.shouldAutoStart]);

  return (
    <OrchestSessionsConsumer>
      <Layout>
        <div className="pipeline-view">
          <div
            className="pane pipeline-view-pane"
            onMouseLeave={disableHotkeys}
            onMouseOver={onMouseOverPipelineView}
          >
            {props.queryArgs.job_uuid && props.queryArgs.read_only == "true" && (
              <div className="pipeline-actions top-left">
                <MDCButtonReact
                  classNames={["mdc-button--outlined"]}
                  label="Back to job"
                  icon="arrow_back"
                  onClick={() => returnToJob(props.queryArgs.job_uuid)}
                  data-test-id="pipeline-back-to-job"
                />
              </div>
            )}

            <div className="pipeline-actions bottom-left">
              <div className="navigation-buttons">
                <MDCButtonReact
                  onClick={centerView}
                  icon="crop_free"
                  data-test-id="pipeline-center"
                />
                <MDCButtonReact onClick={zoomOut} icon="remove" />
                <MDCButtonReact onClick={zoomIn} icon="add" />
              </div>

              {props.queryArgs.read_only !== "true" ? (
                <>
                  {!state.pipelineRunning &&
                    state.eventVars.selectedSteps.length > 0 &&
                    !state.eventVars.stepSelector.active && (
                      <div className="selection-buttons">
                        <MDCButtonReact
                          classNames={[
                            "mdc-button--raised",
                            "themed-secondary",
                          ]}
                          onClick={runSelectedSteps}
                          label="Run selected steps"
                          data-test-id="interactive-run-run-selected-steps"
                        />
                        {selectedStepsHasIncoming && (
                          <MDCButtonReact
                            classNames={[
                              "mdc-button--raised",
                              "themed-secondary",
                            ]}
                            onClick={onRunIncoming}
                            label="Run incoming steps"
                            data-test-id="interactive-run-run-incoming-steps"
                          />
                        )}
                      </div>
                    )}

                  {state.pipelineRunning && (
                    <div className="selection-buttons">
                      <MDCButtonReact
                        classNames={["mdc-button--raised"]}
                        onClick={cancelRun}
                        icon="close"
                        disabled={state.waitingOnCancel}
                        label="Cancel run"
                        data-test-id="interactive-run-cancel"
                      />
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div className={"pipeline-actions top-right"}>
              {props.queryArgs.read_only !== "true" && (
                <MDCButtonReact
                  classNames={["mdc-button--raised"]}
                  onClick={newStep}
                  icon={"add"}
                  label={"NEW STEP"}
                  data-test-id="step-create"
                />
              )}

              {props.queryArgs.read_only === "true" && (
                <MDCButtonReact
                  label={"Read only"}
                  disabled={true}
                  icon={"visibility"}
                />
              )}

              <MDCButtonReact
                classNames={["mdc-button--raised"]}
                onClick={openLogs}
                label={"Logs"}
                icon="view_headline"
              />

              {servicesAvailable() && (
                <MDCButtonReact
                  classNames={["mdc-button--raised"]}
                  onClick={showServices}
                  label={"Services"}
                  icon="settings"
                />
              )}

              <MDCButtonReact
                classNames={["mdc-button--raised"]}
                onClick={() => openSettings(undefined)}
                label={"Settings"}
                icon="tune"
                data-test-id="pipeline-settings"
              />

              {state.eventVars.showServices && servicesAvailable() && (
                <div className="services-status">
                  <h3>Running services</h3>
                  {generateServiceEndpoints()}

                  <div className="edit-button-holder">
                    <MDCButtonReact
                      icon="tune"
                      label={
                        (props.queryArgs.read_only !== "true"
                          ? "Edit"
                          : "View") + " services"
                      }
                      onClick={() => openSettings("services")}
                    />
                  </div>
                </div>
              )}
            </div>

            <div
              className="pipeline-steps-outer-holder"
              ref={state.refManager.nrefs.pipelineStepsOuterHolder}
              onMouseMove={onPipelineStepsOuterHolderMove}
              onMouseDown={onPipelineStepsOuterHolderDown}
              onWheel={onPipelineStepsOuterHolderWheel}
            >
              <div
                className="pipeline-steps-holder"
                ref={state.refManager.nrefs.pipelineStepsHolder}
                style={{
                  transformOrigin: `${state.pipelineOrigin[0]}px ${state.pipelineOrigin[1]}px`,
                  transform:
                    "translateX(" +
                    state.pipelineOffset[0] +
                    "px)" +
                    "translateY(" +
                    state.pipelineOffset[1] +
                    "px)" +
                    "scale(" +
                    state.eventVars.scaleFactor +
                    ")",
                  left: state.pipelineStepsHolderOffsetLeft,
                  top: state.pipelineStepsHolderOffsetTop,
                }}
              >
                {state.eventVars.stepSelector.active && (
                  <Rectangle
                    {...getStepSelectorRectangle(state.eventVars.stepSelector)}
                  ></Rectangle>
                )}
                {pipelineSteps}
                <div className="connections">{connectionComponents}</div>
              </div>
            </div>
          </div>

          {state.eventVars.openedStep && (
            <PipelineDetails
              key={state.eventVars.openedStep}
              onSave={onSaveDetails}
              onDelete={onDetailsDelete}
              onClose={onCloseDetails}
              onOpenFilePreviewView={onOpenFilePreviewView}
              onOpenNotebook={onOpenNotebook}
              onChangeView={onDetailsChangeView}
              connections={connections_list}
              defaultViewIndex={state.defaultDetailViewIndex}
              pipeline={state.pipelineJson}
              pipelineCwd={state.pipelineCwd}
              project_uuid={props.queryArgs.project_uuid}
              job_uuid={props.queryArgs.job_uuid}
              run_uuid={props.queryArgs.run_uuid}
              sio={state.sio}
              readOnly={props.queryArgs.read_only === "true"}
              step={state.steps[state.eventVars.openedStep]}
              saveHash={state.saveHash}
            />
          )}

          {state.eventVars.openedMultistep &&
            props.queryArgs.read_only !== "true" && (
              <div className={"pipeline-actions bottom-right"}>
                <MDCButtonReact
                  classNames={["mdc-button--raised"]}
                  label={"Delete"}
                  onClick={onDeleteMultistep}
                  icon={"delete"}
                  data-test-id="step-delete-multi"
                />
              </div>
            )}
        </div>
      </Layout>
    </OrchestSessionsConsumer>
  );
};

export default PipelineView;
