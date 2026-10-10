"use client";

/**
 * Source/target configuration comparison for one system: per-object counts, the rows of the
 * selected object and a Propose button that sends key and description matches to the steward queue.
 */

import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Mono, Pill, Skeleton, type PillTone } from "@/design";
import { getConfigCompare, proposeConfigMatches, type MatchStatus } from "@/lib/api/config-pairing";
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
  const { data, error, isPending, refetch } = useQuery({
    queryKey: queryKeys.configCompare(systemId, object),
    queryFn: () => getConfigCompare(systemId, object),
    placeholderData: keepPreviousData,
  });
  const propose = useMutation({
    mutationFn: () => proposeConfigMatches(systemId),
    onSuccess: (r) => {
      toast.success(r.proposed ? `${r.proposed} ${r.proposed === 1 ? "match" : "matches"} sent to the steward queue.` : "No new matches to propose.");
      void qc.invalidateQueries({ queryKey: ["config-compare", systemId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Matches were not proposed."),
  });

  let body;
  if (isPending) {
    body = <Skeleton height={96} />;
  } else if (error) {
    body = <ErrorState message={`The comparison could not be read. ${error.message}`} onRetry={() => void refetch()} />;
  } else if (!data.source_load_id) {
    body = <EmptyState title="Load this system's configuration to compare it with its target." />;
  } else if (data.objects.length === 0) {
    body = <EmptyState title="The source and the target share no configuration objects." />;
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <table className="w-full text-[13px]" style={{ color: "var(--m-ink)" }}>
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
        {object && data.rows.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}><Mono>{object}</Mono> values</p>
            {data.rows.map((r) => (
              <div key={r.source_key} className="flex items-center justify-between gap-2 rounded border px-3 py-1.5 text-[13px]" style={{ borderColor: "var(--m-line)" }}>
                <span className="flex items-center gap-2">
                  <Mono>{r.source_key}</Mono>
                  {r.target_key && r.target_key !== r.source_key ? <span style={{ color: "var(--m-ink-2)" }}>to <Mono>{r.target_key}</Mono></span> : null}
                </span>
                <Pill tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>
            Compared with {data?.target.label ?? "the target"}
          </p>
          {data?.target.baseline ? (
            <p className="text-[12px]" style={{ color: "var(--m-medium)" }}>
              The target is the SAP standard baseline, so differences are flagged, not blocking.
            </p>
          ) : null}
        </div>
        {canPropose && data?.source_load_id ? (
          <Button variant="secondary" disabled={propose.isPending} onClick={() => propose.mutate()}>Propose matches</Button>
        ) : null}
      </div>
      <div className="mt-2">{body}</div>
    </div>
  );
}
