import React from "react";
import PipelineView from "../views/PipelineView";
import MDCButtonReact from "../lib/mdc-components/MDCButtonReact";
import JupyterLabView from "../views/JupyterLabView";
import MDCCircularProgressReact from "../lib/mdc-components/MDCCircularProgressReact";
import MDCIconButtonToggleReact from "../lib/mdc-components/MDCIconButtonToggleReact";
import ProjectSelector from "./ProjectSelector";
import SettingsView from "../views/SettingsView";
import HelpView from "../views/HelpView";
import { RefManager } from "../lib/utils/all";
import SessionToggleButton from "./SessionToggleButton";

class HeaderBar extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      pipeline_uuid: undefined,
      project_uuid: undefined,
      sessionActive: false,
      readOnlyPipeline: false,
      viewShowing: "pipeline",
      pipelineSaveStatus: "saved",
      onSessionStateChange: undefined,
      onSessionShutdown: undefined,
      onSessionFetch: undefined,
    };

    this.refManager = new RefManager();
  }

  showPipeline() {
    this.updateCurrentView("pipeline");
    orchest.loadView(PipelineView, {
      queryArgs: {
        pipeline_uuid: this.state.pipeline_uuid,
        project_uuid: this.state.project_uuid,
      },
    });
  }

  showJupyter() {
    this.updateCurrentView("jupyter");
    orchest.loadView(JupyterLabView, {
      queryArgs: {
        pipeline_uuid: this.state.pipeline_uuid,
        project_uuid: this.state.project_uuid,
      },
    });
  }

  updateCurrentView(view) {
    this.setState({
      viewShowing: view,
    });
  }

  updateReadOnlyState(readOnly) {
    this.setState({
      readOnlyPipeline: readOnly,
    });
  }

  clearPipeline() {
    this.setState({
      pipeline_uuid: undefined,
      project_uuid: undefined,
      pipelineName: undefined,
      onSessionStateChange: undefined,
      onSessionShutdown: undefined,
      onSessionFetch: undefined,
    });
  }

  setPipeline(
    pipeline_uuid,
    project_uuid,
    pipelineName,
    onSessionStateChange,
    onSessionShutdown,
    onSessionFetch
  ) {
    this.setState(
      {
        pipeline_uuid,
        project_uuid,
        pipelineName,
        onSessionStateChange,
        onSessionShutdown,
        onSessionFetch,
      },
      () => {
        if (this.refManager.refs.sessionToggleButton) {
          this.refManager.refs.sessionToggleButton.fetchSessionStatus();
        }
      }
    );
  }

  pipelineSaveStatus(status) {
    this.setState({
      pipelineSaveStatus: status,
    });
  }

  logoutHandler() {
    window.location.href = "/login/clear";
  }

  handleMenuButton() {
    this.props.toggleDrawer();
  }

  onChangeProject(projectUUID) {
    this.props.changeSelectedProject(projectUUID);
  }

  toggleSession() {
    if (this.refManager.refs.sessionToggleButton) {
      this.refManager.refs.sessionToggleButton.toggleSession();
    }
  }

  onSessionStateChange(working, running, session_details) {
    this.setState({
      sessionActive: running,
    });

    if (this.state.onSessionStateChange) {
      this.state.onSessionStateChange(working, running, session_details);
    }
  }

  onSessionFetch(session_details) {
    if (this.state.onSessionFetch) {
      this.state.onSessionFetch(session_details);
    }
  }

  onSessionShutdown() {
    if (this.state.onSessionShutdown) {
      this.state.onSessionShutdown();
    }
  }

  render() {
    return (
      <header>
        <div className="header-left">
          <button
            onClick={this.handleMenuButton.bind(this)}
            className="material-icons mdc-icon-button"
          >
            menu
          </button>
          <img src="public/image/logo.svg" className="logo" />
          <ProjectSelector
            key={this.props.projectSelectorHash}
            onChangeProject={this.onChangeProject.bind(this)}
            project_uuid={this.props.selectedProject}
          />
        </div>

        {this.state.pipelineName && (
          <div className="pipeline-header-component">
            <div className="pipeline-name">
              <div className="pipelineStatusIndicator">
                {this.state.pipelineSaveStatus == "saved" ? (
                  <i title="Pipeline saved" className="material-icons">
                    check_circle
                  </i>
                ) : (
                  <MDCCircularProgressReact />
                )}
              </div>

              {this.state.pipelineName}
            </div>
          </div>
        )}

        <div className="global-actions">
          {this.state.pipelineName && !this.state.readOnlyPipeline && (
            <SessionToggleButton
              ref={this.refManager.nrefs.sessionToggleButton}
              pipeline_uuid={this.state.pipeline_uuid}
              project_uuid={this.state.project_uuid}
              onSessionStateChange={this.onSessionStateChange.bind(this)}
              onSessionFetch={this.onSessionFetch.bind(this)}
              onSessionShutdown={this.onSessionShutdown.bind(this)}
            />
          )}

          {this.state.pipelineName && this.state.viewShowing == "jupyter" && (
            <MDCButtonReact
              classNames={["mdc-button--outlined"]}
              onClick={this.showPipeline.bind(this)}
              icon="device_hub"
              label="Switch to Pipeline"
            />
          )}

          {this.state.pipelineName &&
            !this.state.readOnlyPipeline &&
            this.state.viewShowing == "pipeline" && (
              <MDCButtonReact
                disabled={!this.state.sessionActive}
                classNames={["mdc-button--outlined"]}
                onClick={this.showJupyter.bind(this)}
                icon="science"
                label="Switch to JupyterLab"
              />
            )}

          {orchest.user_config.AUTH_ENABLED && (
            <MDCIconButtonToggleReact
              icon="logout"
              tooltipText="Logout"
              onClick={this.logoutHandler.bind(this)}
            />
          )}
          <MDCIconButtonToggleReact
            icon="settings"
            tooltipText="Settings"
            onClick={orchest.loadView.bind(orchest, SettingsView)}
          />
          <MDCIconButtonToggleReact
            icon="help"
            tooltipText="Help"
            onClick={orchest.loadView.bind(orchest, HelpView)}
          />
        </div>
      </header>
    );
  }
}

export default HeaderBar;
