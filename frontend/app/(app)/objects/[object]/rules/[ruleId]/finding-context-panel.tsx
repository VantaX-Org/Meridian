"use client";

/** The source and target configuration behind a rule: the config object, the target and the source keys it lacks. */

import { useQuery } from "@tanstack/react-query";
import { Card, ErrorState, Mono, Pill } from "@/design";
import { getFindingContext } from "@/lib/api/config-pairing";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

export function FindingContextPanel({ ruleId, run, moduleId, fields }: {
  ruleId: string; run: string; moduleId: string; fields: string[];
}) {
  const query = useQuery({
    queryKey: queryKeys.findingContext(ruleId, run),
    queryFn: () => getFindingContext({ ruleId, module: moduleId, versionId: run || undefined, fields }),
  });
  if (isListFailure(query)) {
    return (
      <ErrorState
        message={`The configuration context could not be read. ${apiErrorMessage(query.error)}`}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const { data } = query;
  if (!data || !data.object || data.source.length === 0) return null;
  return (
    <Card
      title="Configuration context"
      meta={<><Mono>{data.object}</Mono>{data.baseline ? <> <Pill tone="neutral">Baseline target</Pill></> : null}</>}
      padding="sm"
    >
      <p className="m-ink-2">
        {data.missing_total} of {data.source.length} source values are not configured in {data.target_label}.
      </p>
      {data.missing.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.missing.map((k) => <Mono key={k}>{k}</Mono>)}
        </div>
      ) : null}
    </Card>
  );
}
