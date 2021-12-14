import { StrategyJson } from "@/types";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import "codemirror/mode/javascript/javascript";
import React from "react";
import { Controlled as CodeMirror } from "react-codemirror2";
import ParamTree from "./ParamTree";

interface IParameterEditorProps {
  strategyJSON: StrategyJson;
  pipelineName: string;
  readOnly?: boolean;
  onParameterChange?: (
    value: Record<string, { parameters: Record<string, string> }>
  ) => void;
}

const ParameterEditor: React.FC<IParameterEditorProps> = (props) => {
  const [strategyJSON, setStrategyJson] = React.useState<StrategyJson>(
    props.strategyJSON
  );
  const [activeParameter, setActiveParameter] = React.useState<{
    key: string;
    strategyJSONKey: string;
  }>(null);

  const [codeMirrorValue, setCodeMirrorValue] = React.useState("");

  const editParameter = (key: string, strategyJSONKey: string) => {
    setActiveParameter({ key, strategyJSONKey });
    setCodeMirrorValue(strategyJSON[strategyJSONKey].parameters[key]);
  };

  return (
    <div className="parameter-editor">
      <div className="columns">
        <div className="column">
          <ParamTree
            pipelineName={props.pipelineName}
            strategyJSON={strategyJSON}
            editParameter={editParameter}
            data-test-id={props["data-test-id"]}
          />
        </div>
        <div className="column">
          {activeParameter !== undefined && props.readOnly !== true && (
            <>
              <CodeMirror
                value={codeMirrorValue}
                options={{
                  mode: "application/json",
                  theme: "jupyter",
                  lineNumbers: true,
                }}
                onBeforeChange={(editor, data, value) => {
                  setStrategyJson((json) => {
                    json[activeParameter.strategyJSONKey].parameters[
                      activeParameter.key
                    ] = value;
                    setCodeMirrorValue(value);

                    // only call onParameterChange if valid JSON Array
                    // put this block into event-loop to speed up the typing
                    window.setTimeout(() => {
                      try {
                        if (Array.isArray(JSON.parse(value))) {
                          props.onParameterChange(json);
                        }
                      } catch {
                        console.warn("Invalid JSON entered");
                      }
                    }, 0);

                    return json;
                  });
                }}
              />
              {(() => {
                try {
                  if (codeMirrorValue) JSON.parse(codeMirrorValue);
                } catch {
                  return (
                    <Alert
                      severity="warning"
                      sx={{ marginTop: (theme) => theme.spacing(2) }}
                    >
                      Your input is not valid JSON.
                    </Alert>
                  );
                }
              })()}
            </>
          )}
          {activeParameter !== undefined && props.readOnly === true && (
            <>
              <CodeMirror
                onBeforeChange={() => null}
                value={codeMirrorValue}
                options={{
                  mode: "application/json",
                  theme: "jupyter",
                  lineNumbers: true,
                }}
              />
              <Typography sx={{ marginTop: (theme) => theme.spacing(2) }}>
                <i>Read only</i>
              </Typography>
            </>
          )}
        </div>
        <div className="clear"></div>
      </div>
    </div>
  );
};

export default ParameterEditor;
