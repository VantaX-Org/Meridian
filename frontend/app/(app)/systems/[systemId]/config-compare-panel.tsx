"use client";

/**
 * Source/target configuration comparison for one system: per-object counts, the rows of the
 * selected object and a Propose button that sends key and description matches to the steward queue.
 */

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Button, Card, EmptyState, ErrorState, Mono, Notice, Pill, Skeleton, type PillTone } from "@/design";
import { getConfigCompare, proposeConfigMatches, type MatchStatus } from "@/lib/api/config-pairing";
import { apiErrorDetail, apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const STATUS_LABEL: Record<MatchStatus, string> = {
  exists: "In target",
  key_match: "Key match",
  desc_match: "Description match",
  missing: "Missing",
};
const STATUS_TONE: Record<MatchStatus, PillTone> = {
  exists: "go",
  key_match: "at-risk",
  desc_match: "at-risk",
  missing: "no-go",
};

export function ConfigComparePanel({ systemId, canPropose }: { systemId: string; canPropose: boolean }) {
  const qc = useQueryClient();
  const [object, setObject] = useState<string | undefined>(undefined);
  const query = useQuery({
    queryKey: queryKeys.configCompare(systemId, object),
    queryFn: () => getConfigCompare(systemId, object),
    placeholderData: keepPreviousData,
  });
  const { data, isPending, refetch } = query;
  const propose = useMutation({
    mutationFn: () => proposeConfigMatches(systemId),
    onSuccess: (r) => {
      toast.success(r.proposed ? `${r.proposed} ${r.proposed === 1 ? "match" : "matches"} sent to the steward queue.` : "No new matches to propose.");
      void qc.invalidateQueries({ queryKey: ["config-compare", systemId] });
    },
    onError: (e) => toast.error(apiErrorDetail(e) ?? "Matches were not proposed."),
  });

  let body;
  if (isPending) {
    body = <Skeleton height={96} />;
  } else if (isListFailure(query)) {
    body = <ErrorState message={`The comparison could not be read. ${apiErrorMessage(query.error)}`} onRetry={() => void refetch()} />;
  } else if (!data?.source_load_id) {
    body = <EmptyState title="Nothing to compare yet"
      detail="Load this system's configuration to compare it with its target."
      action={<Button render={<Link href={`/systems/${systemId}?tab=health`}>Load configuration</Link>} />} />;
  } else if (data.objects.length === 0) {
    body = <EmptyState title="No shared configuration objects"
      detail="The source and the target have no configuration object in common."
      action={<Button render={<Link href={`/systems/${systemId}?tab=health`}>Load configuration</Link>} />} />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <table className="w-full m-text-body" style={{ color: "var(--m-ink)" }}>
          <thead>
            <tr style={{ color: "var(--m-ink-2)" }}>
              <th className="text-left font-medium">Object</th>
              <th className="text-right font-medium">In target</th>
              <th className="text-right font-medium">Key match</th>
              <th className="text-right font-medium">Description match</th>
              <th className="text-right font-medium">Missing</th>
            </tr>
          </thead>
          <tbody>
            {data.objects.map((o) => (
              <tr key={o.object} className="border-t" style={{ borderColor: "var(--m-line)" }}>
                <td>
                  <button type="button" className="underline" onClick={() => setObject(o.object)}>
                    <Mono>{o.object}</Mono>
                  </button>
                </td>
                <td className="text-right">{o.exists}</td>
                <td className="text-right">{o.key_match}</td>
                <td className="text-right">{o.desc_match}</td>
                <td className="text-right" style={{ color: o.missing ? "var(--m-critical)" : "var(--m-ink)" }}>{o.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const values = object && data?.rows.length ? (
    <Card title={<><Mono>{object}</Mono> values</>}>
      <ul className="flex flex-col">
        {data.rows.map((r) => (
          <li key={r.source_key} className="flex items-center justify-between gap-2 border-t py-2 m-text-body first:border-t-0" style={{ borderColor: "var(--m-line)" }}>
            <span className="flex items-center gap-2">
              <Mono>{r.source_key}</Mono>
              {r.target_key && r.target_key !== r.source_key ? <span style={{ color: "var(--m-ink-2)" }}>to <Mono>{r.target_key}</Mono></span> : null}
            </span>
            <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
    <Card
      title={`Compared with ${data?.target.label ?? "the target"}`}
      actions={canPropose && data?.source_load_id ? (
        <Button variant="secondary" disabled={propose.isPending} onClick={() => propose.mutate()}>Propose matches</Button>
      ) : undefined}
    >
      {data?.target.baseline ? (
        <Notice tone="info">The target is the SAP standard baseline, so differences are flagged, not blocking.</Notice>
      ) : null}
      {body}
    </Card>
    {values}
    </div>
  );
}
