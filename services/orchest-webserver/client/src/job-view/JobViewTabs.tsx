import { TabLabel, Tabs } from "@/components/common/Tabs";
import { Job } from "@/types";
import ListIcon from "@mui/icons-material/List";
import TuneIcon from "@mui/icons-material/Tune";
import ViewComfyIcon from "@mui/icons-material/ViewComfy";
import Tab from "@mui/material/Tab";
import React from "react";

export const JobViewTabs: React.FC<{
  job: Job;
  children: (tabIndex: number) => React.ReactNode;
}> = ({ job, children }) => {
  const [tabIndex, setTabIndex] = React.useState(0);
  const onSelectSubview = (e, index: number) => {
    setTabIndex(index);
  };
  const tabs = React.useMemo(() => {
    if (!job) return [];
    return [
      {
        id: "pipeline-runs",
        label: `Pipeline runs (${
          job.pipeline_runs.filter(({ status }) =>
            ["SUCCESS", "ABORTED", "FAILURE"].includes(status)
          ).length
        }/${job.pipeline_runs.length})`,
        icon: <ListIcon />,
      },
      {
        id: "parameters",
        label: "Parameters",
        icon: <TuneIcon />,
      },
      {
        id: "environment-variables",
        label: "Environment variables",
        icon: <ViewComfyIcon />,
      },
    ];
  }, [job?.pipeline_runs]);

  return (
    <>
      <Tabs
        value={tabIndex}
        onChange={onSelectSubview}
        label="View Job Tabs"
        data-test-id="job-view"
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            label={<TabLabel icon={tab.icon}>{tab.label}</TabLabel>}
            aria-controls={tab.id}
            data-test-id={`${tab.id}-tab`}
          />
        ))}
      </Tabs>
      {children(tabIndex)}
    </>
  );
};
