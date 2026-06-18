"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHead, KPI } from "@/components/meridian/atoms";
import { PlayTriangleIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getModuleStatuses,
  triggerModules,
  type ModuleStatus,
} from "@/lib/api/sync-trigger";

type RowStatus = "idle" | "queued" | "running" | "done";

const SYS_GLYPHS: Record<string, string> = {
  ECC: "ECC",
  SuccessFactors: "SF",
  Warehouse: "WH",
};

function statusFromBackend(s: ModuleStatus["status"]): RowStatus {
  switch (s) {
    case "running":
      return "running";
    case "completed":
      return "done";
    case "failed":
      return "idle";
    default:
      return "idle";
  }
}

export default function RunSyncPage() {
  const qc = useQueryClient();
  const { data: modules, isLoading, error } = useQuery({
    queryKey: ["sync-trigger.modules"],
    queryFn: getModuleStatuses,
    refetchInterval: 6_000,
  });

  // Local override of statuses for instant feedback on trigger.
  // Reconciled from backend on every poll (backend wins).
  const [localStatus, setLocalStatus] = useState<Record<string, RowStatus>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Group by category — preserves insertion order from backend.
  const groups = useMemo(() => {
    if (!modules) return [] as { name: string; modules: ModuleStatus[] }[];
    const byCat = new Map<string, ModuleStatus[]>();
    for (const m of modules) {
      const list = byCat.get(m.category) ?? [];
      list.push(m);
      byCat.set(m.category, list);
    }
    return Array.from(byCat.entries()).map(([name, mods]) => ({ name, modules: mods }));
  }, [modules]);

  const allModuleIds = useMemo(() => (modules ?? []).map((m) => m.module_id), [modules]);
  const allSelected = selected.size === allModuleIds.length && allModuleIds.length > 0;

  // Build the effective status table from backend + local overrides.
  const statuses: Record<string, RowStatus> = useMemo(() => {
    const next: Record<string, RowStatus> = {};
    for (const m of modules ?? []) {
      next[m.module_id] = localStatus[m.module_id] ?? statusFromBackend(m.status);
    }
    return next;
  }, [modules, localStatus]);

  // Clear local overrides once backend confirms the new state.
  useEffect(() => {
    if (!modules) return;
    setLocalStatus((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const m of modules) {
        const backend = statusFromBackend(m.status);
        const local = next[m.module_id];
        if (local && local === backend) {
          delete next[m.module_id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [modules]);

  const trigger = useMutation({
    mutationFn: (ids: string[]) => triggerModules(ids),
    onMutate: (ids) => {
      setLocalStatus((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = "queued";
        return next;
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sync-trigger.modules"] });
    },
  });

  const toggle = (m: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };

  const toggleGroup = (group: { name: string; modules: ModuleStatus[] }) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const ids = group.modules.map((m) => m.module_id);
      const allOn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  const selectAll = () => setSelected(allSelected ? new Set() : new Set(allModuleIds));
  const runSelected = () => {
    if (selected.size === 0) return;
    trigger.mutate([...selected]);
  };
  const runOne = (id: string) => trigger.mutate([id]);

  const runCount = Object.values(statuses).filter((s) => s === "running" || s === "queued").length;
  const doneCount = Object.values(statuses).filter((s) => s === "done").length;

  if (isLoading) {
    return (
      <>
        <PageHead title="Run Sync" route="Analyse · /run-sync" sub="Loading modules…" />
        <div className="mn-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 18 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
        <div className="mn-runsync-groups">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-[10px]" />
          ))}
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHead title="Run Sync" route="Analyse · /run-sync" sub="Failed to load modules." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/sync-trigger/modules</code>. Check the API is running.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Run Sync"
        route="Analyse · /run-sync"
        sub="Select modules to re-run analysis against the most recent uploaded data."
        actions={
          <>
            <span className="mn-pill">
              <span className="pdot" /> Connected · {groups.length} systems
            </span>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={selectAll}>
              {allSelected ? "Clear selection" : "Select all"}
            </button>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={runSelected}
              disabled={selected.size === 0 || trigger.isPending}
            >
              <PlayTriangleIcon size={14} /> Run analysis
              {selected.size > 0 && <span className="mn-runsync-count">{selected.size}</span>}
            </button>
          </>
        }
      />

      <div
        className="mn-row mn-stagger"
        style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}
      >
        <KPI label="Modules connected" value={allModuleIds.length} hint={`${groups.length} source systems`} />
        <KPI
          label="Selected"
          value={selected.size}
          hint={selected.size === 0 ? "pick modules below" : "ready to run"}
          tone={selected.size > 0 ? "pos" : undefined}
        />
        <KPI
          label="In flight"
          value={runCount}
          hint={runCount === 0 ? "idle" : "running now"}
          tone={runCount > 0 ? "warn" : undefined}
        />
        <KPI label="Completed · session" value={doneCount} hint="this view" tone={doneCount > 0 ? "pos" : undefined} />
      </div>

      <div className="mn-runsync-groups">
        {groups.map((group) => {
          const ids = group.modules.map((m) => m.module_id);
          const allOn = ids.every((id) => selected.has(id));
          const someOn = ids.some((id) => selected.has(id));
          const groupSelectedCount = ids.filter((id) => selected.has(id)).length;
          return (
            <div key={group.name} className="mn-card mn-runsync-group">
              <div className="mn-runsync-group-head">
                <span className="mn-runsync-glyph">
                  {SYS_GLYPHS[group.name] ?? group.name.slice(0, 3).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mn-runsync-group-name">{group.name}</div>
                  <div className="mn-runsync-group-meta">
                    {group.modules.length} modules
                    {someOn && (
                      <>
                        {" "}·{" "}
                        <strong style={{ color: "var(--mn-primary-700)" }}>
                          {groupSelectedCount} selected
                        </strong>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => toggleGroup(group)}
                  style={{ padding: "5px 11px", fontSize: 12 }}
                >
                  {allOn ? "Clear" : "Select all"}
                </button>
              </div>

              <div className="mn-runsync-list">
                {group.modules.map((m) => {
                  const status = statuses[m.module_id];
                  const isSelected = selected.has(m.module_id);
                  const locked = status === "running" || status === "queued";
                  return (
                    <label key={m.module_id} className={`mn-runsync-row ${isSelected ? "selected" : ""}`}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(m.module_id)}
                        disabled={locked}
                      />
                      <span className={`mn-runsync-check ${isSelected ? "on" : ""}`}>
                        {isSelected && (
                          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                            <path
                              d="m2.5 6.5 2.5 2.5 5-5.5"
                              stroke="white"
                              strokeWidth="2"
                              fill="none"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </span>
                      <span className="mn-runsync-name">{m.label}</span>
                      <span className={`mn-runsync-status status-${status}`}>
                        {status === "running" && <span className="mn-spinner" />}
                        {status === "queued" && "Queued"}
                        {status === "running" && "Running"}
                        {status === "done" && "✓ Done"}
                        {status === "idle" && "Idle"}
                      </span>
                      <button
                        type="button"
                        className="mn-runsync-run"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          runOne(m.module_id);
                        }}
                        disabled={locked}
                        title={`Run ${m.label}`}
                        aria-label={`Run ${m.label}`}
                      >
                        <PlayTriangleIcon size={11} />
                      </button>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
