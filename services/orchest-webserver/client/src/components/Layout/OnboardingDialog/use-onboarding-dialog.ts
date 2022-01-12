import { useAppContext } from "@/contexts/AppContext";
import { useProjectsContext } from "@/contexts/ProjectsContext";
import { useImportUrl } from "@/hooks/useImportUrl";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { hasValue } from "@orchest/lib-utils";
import React from "react";
import useSWR from "swr";

export const useOnboardingDialog = () => {
  const { data: state, mutate: setState } = useSWR(
    "useOnboardingDialog",
    null,
    {
      initialData: { isOpen: false, shouldFetchQuickstart: false },
    }
  );
  const { dispatch } = useAppContext();
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useLocalStorage(
    "onboarding_completed",
    false
  );

  const projectsContext = useProjectsContext();
  const [importUrl] = useImportUrl();

  const findQuickstart = projectsContext.state.projects?.find(
    (project) => project.path === "quickstart"
  );
  const quickstart =
    typeof findQuickstart === "undefined"
      ? undefined
      : {
          project_uuid: findQuickstart.uuid,
          pipeline_uuid: "0915b350-b929-4cbd-b0d4-763cac0bb69f",
        };
  const hasQuickstart = typeof quickstart !== "undefined";

  const setIsOnboardingDialogOpen = (
    isOpen: boolean,
    onOpen?: (value: boolean) => void
  ) => {
    if (isOpen) {
      setState({ isOpen: true, shouldFetchQuickstart: true });
    } else {
      setState((prevState) => ({ ...prevState, isOpen: false }));

      // update localstorage
      setHasCompletedOnboarding(true);
      // update app context
      dispatch({ type: "SET_HAS_COMPLETED_ONBOARDING", payload: true });
      // Wait for Dialog transition to finish before resetting position.
      // This way we avoid showing the slides animating back to the start.

      setState((prevState) => ({
        ...prevState,
        shouldFetchQuickstart: false,
      }));
      onOpen && onOpen(false);
    }
  };

  React.useEffect(() => {
    dispatch({
      type: "SET_HAS_COMPLETED_ONBOARDING",
      payload: hasCompletedOnboarding,
    });
    if (!hasCompletedOnboarding) setIsOnboardingDialogOpen(true);
  }, []);

  return {
    isOnboardingDialogOpen: state?.isOpen,
    setIsOnboardingDialogOpen,
    quickstart,
    hasImportUrl: hasValue(importUrl),
    hasQuickstart,
  };
};
