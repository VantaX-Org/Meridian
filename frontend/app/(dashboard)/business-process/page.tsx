"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { getVersions } from "@/lib/api/versions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import type { BusinessProcessL1, Version } from "@/types/api";

function isCompleteVersion(v: Version): boolean {
  return (v.status === "agents_complete" || v.status === "complete" || v.status === "ai_enriched") && !!v.dqs_summary;
}

function dqStatusForProcess(p: BusinessProcessL1): "healthy" | "at-risk" | "broken" {
  let red = 0, amber = 0, green = 0;
  for (const l2 of p.l2_groups) {
    for (const l3 of l2.l3_processes ?? []) {
      for (const l4 of l3.l4_steps ?? []) {
        for (const l5 of l4.l5_fields ?? []) {
          if (l5.dq_status === "red") red++;
          else if (l5.dq_status === "amber") amber++;
          else green++;
        }
      }
    }
  }
  if (red > 0) return "broken";
  if (amber > 0) return "at-risk";
  return "healthy";
}

export default function BusinessProcessPage() {
  const versionsQ = useQuery({
    queryKey: ["versions.list", { limit: 10 }],
    queryFn: () => getVersions({ limit: 10 }),
  });

  const latest = useMemo(
    () => versionsQ.data?.versions.find(isCompleteVersion),
    [versionsQ.data],
  );
  const availableModules = useMemo(
    () => (latest?.dqs_summary ? Object.keys(latest.dqs_summary) : []),
    [latest],
  );

  const [module, setModule] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const effectiveModule = module ?? availableModules[0] ?? null;

  const bpQ = useQuery({
    queryKey: ["business-process", latest?.id, effectiveModule],
    queryFn: () => getBusinessProcess(latest!.id, effectiveModule!),
    enabled: !!latest && !!effectiveModule,
  });

  if (versionsQ.isLoading) {
    return (
      <>
        <PageHead title="Business Processes" route="Connect · /business-process" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }

  if (!latest) {
    return (
      <>
        <PageHead
          title="Business Processes"
          route="Connect · /business-process"
          sub="Business process readiness runs against a completed version."
        />
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
          Run an analysis from <code>/run-sync</code> to populate process readiness.
        </div>
      </>
    );
  }

  const processes: BusinessProcessL1[] = bpQ.data ?? [];
  const healthy = processes.filter((p) => dqStatusForProcess(p) === "healthy").length;
  const atRisk = processes.filter((p) => dqStatusForProcess(p) === "at-risk").length;
  const broken = processes.filter((p) => dqStatusForProcess(p) === "broken").length;

  return (
    <>
      <PageHead
        title="Business Processes"
        route="Connect · /business-process"
        sub={
          <>
            Process readiness for version{" "}
            <span style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
              {latest.id.slice(0, 8)}
            </span>{" "}
            ({latest.label ?? "Unlabelled run"}).
          </>
        }
        actions={
          <SearchField value={search} onChange={setSearch} placeholder="Filter processes…" />
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Processes" value={processes.length} />
        <KPI label="Healthy" value={healthy} tone="pos" />
        <KPI label="At risk" value={atRisk} tone="warn" />
        <KPI label="Broken" value={broken} tone="neg" />
      </div>

      <div className="mn-segment" style={{ marginBottom: 14, flexWrap: "wrap" }}>
        {availableModules.map((m) => (
          <button
            key={m}
            type="button"
            className={effectiveModule === m ? "on" : ""}
            onClick={() => setModule(m)}
          >
            {m}
          </button>
        ))}
      </div>

      {bpQ.isLoading && <Skeleton className="h-60 rounded-[10px]" />}

      {!bpQ.isLoading && (
        <>
          <SectionHeader title="Process portfolio" caption={`L1 processes for module ${effectiveModule}`} />
          <div className="mn-row" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}>
            {processes.filter((p) => matchesSearch(p, search)).map((p) => {
              const status = dqStatusForProcess(p);
              const stroke =
                status === "healthy"
                  ? "var(--mn-pos)"
                  : status === "at-risk"
                    ? "var(--mn-warn)"
                    : "var(--mn-neg)";
              const l5Count = p.l2_groups.reduce(
                (a, l2) => a + (l2.l3_processes ?? []).reduce(
                  (b, l3) => b + (l3.l4_steps ?? []).reduce(
                    (c, l4) => c + (l4.l5_fields ?? []).length, 0,
                  ), 0,
                ), 0,
              );
              return (
                <div key={p.l1_id} className={`mn-process-card ${status === "broken" ? "broken" : ""}`}>
                  <div className="mn-process-head">
                    <div>
                      <span className="mn-eyebrow">{p.l1_id}</span>
                      <div className="mn-process-name">{p.l1_name}</div>
                      <div className="mn-process-owner">{p.system}</div>
                    </div>
                    <ArrowRight size={14} style={{ color: "var(--mn-ink-300)" }} />
                  </div>
                  <p style={{ margin: 0, fontSize: 12.5, color: "var(--mn-ink-500)", lineHeight: 1.45 }}>
                    {p.l1_description}
                  </p>
                  <div className="mn-process-stats">
                    <div>
                      <span className="mn-eyebrow">L2 groups</span>
                      <span className="v mn-tabular">{p.l2_groups.length}</span>
                    </div>
                    <div>
                      <span className="mn-eyebrow">L5 fields</span>
                      <span className="v mn-tabular">{l5Count}</span>
                    </div>
                    <div>
                      <span className="mn-eyebrow">Status</span>
                      <span className="v" style={{ color: stroke, textTransform: "uppercase", fontSize: 12 }}>
                        {status}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
            {processes.filter((p) => matchesSearch(p, search)).length === 0 && (
              <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
                {processes.length === 0
                  ? `No process data for ${effectiveModule}.`
                  : "No processes match this filter."}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
