import type { PipelineMetaData } from "@/types";
import { fetcher } from "@orchest/lib-utils";
import React from "react";
import useSWR, { cache } from "swr";
import { MutatorCallback } from "swr/dist/types";

export const useFetchPipelines = (projectUuid: string | undefined) => {
  const { data, error, isValidating, revalidate, mutate } = useSWR<
    PipelineMetaData[]
  >(projectUuid ? `/async/pipelines/${projectUuid}` : null, (url) =>
    fetcher<{ result: PipelineMetaData[] }>(url).then(
      (response) => response.result
    )
  );

  const setPipelines = React.useCallback(
    (
      data?:
        | PipelineMetaData[]
        | Promise<PipelineMetaData[]>
        | MutatorCallback<PipelineMetaData[]>
    ) => mutate(data, false),
    [mutate]
  );

  return {
    pipelines: data,
    error,
    isFetchingPipelines: isValidating,
    fetchPipelines: revalidate,
    setPipelines,
    // provide a simple way to get fetched data via projectUuid
    // in case that we need to fetch pipelines conditionally
    getCache: (projectUuid: string) =>
      cache.get(`/async/pipelines/${projectUuid}`),
  };
};
