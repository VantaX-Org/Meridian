"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, ModChip } from "@/components/meridian/atoms";
import { ArrowRight, MoreH } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  approveCleaning,
  bulkApprove,
  getCleaningQueue,
  rejectCleaning,
  rollbackCleaning,
  type CleaningQueueItem,
} from "@/lib/api/cleaning";
import { copyToClipboard } from "@/components/meridian/actions";
import { ConfirmDialog } from "@/components/meridian/controls";
import { relativeTime } from "@/lib/format";

function previewLine(item: CleaningQueueItem): string {
  if (item.merge_preview && typeof item.merge_preview === "object") {
    const entries = Object.entries(item.merge_preview);
    if (entries.length > 0) {
      const [field, m] = entries[0];
      return `${field}: ${m.a} | ${m.b} → ${m.survivor}`;
    }
  }
  if (item.golden_field_value) return String(item.golden_field_value);
  return item.record_key;
}

function statusToBucket(s: string): "auto" | "review" {
  if (s === "auto_approved" || s === "applied" || s === "verified") return "auto";
  return "review";
}

export default function CleaningPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "auto" | "review">("all");
  const [autoOpen, setAutoOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["cleaning.queue", { filter }],
    queryFn: () =>
      getCleaningQueue({
        per_page: 100,
        status: filter === "all" ? undefined : filter === "auto" ? "auto_approved" : "recommended",
      }),
  });

  const approve = useMutation({
    mutationFn: (id: string) => approveCleaning(id),
    onSuccess: () => {
      toast.success("Cleaning job approved");
      qc.invalidateQueries({ queryKey: ["cleaning.queue"] });
    },
    onError: () => toast.error("Could not approve job"),
  });
  const reject = useMutation({
    mutationFn: (id: string) => rejectCleaning(id, "Reviewed and rejected"),
    onSuccess: () => {
      toast.success("Cleaning job rejected");
      qc.invalidateQueries({ queryKey: ["cleaning.queue"] });
    },
    onError: () => toast.error("Could not reject job"),
  });
  const rollback = useMutation({
    mutationFn: (id: string) => rollbackCleaning(id),
    onSuccess: () => {
      toast.success("Cleaning job rolled back");
      qc.invalidateQueries({ queryKey: ["cleaning.queue"] });
    },
    onError: () => toast.error("Could not roll back job"),
  });
  const runAuto = useMutation({
    mutationFn: () => bulkApprove({ max_count: 100 }),
    onSuccess: (d) => {
      toast.success(
        `Auto-approved ${d.approved_count} job${d.approved_count === 1 ? "" : "s"}` +
          (d.skipped_count ? ` · ${d.skipped_count} skipped` : ""),
      );
      qc.invalidateQueries({ queryKey: ["cleaning.queue"] });
    },
    onError: () => toast.error("Could not run auto-jobs"),
  });

  const items: CleaningQueueItem[] = data?.items ?? [];
  const total = data?.total ?? items.length;

  const summary = useMemo(() => {
    // total (the API's own COUNT(*), not capped by per_page) — not
    // items.length, which is capped at the fetched page (per_page: 100,
    // itself the API's max) and would silently disagree with the subhead
    // above, which already correctly shows `total`. auto/review are a
    // breakdown of the fetched page only — no backend aggregate exists yet
    // to compute those two beyond the current page's 100-item cap.
    const queued = total;
    const auto = items.filter((i) => statusToBucket(i.status) === "auto").length;
    const review = items.filter((i) => statusToBucket(i.status) === "review").length;
    return { queued, auto, review };
  }, [items, total]);

  if (isLoading) {
    return (
      <>
        <PageHead title="Cleaning Queue" route="Steward · /cleaning" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Cleaning Queue" route="Steward · /cleaning" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/cleaning/queue</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Cleaning Queue"
        route="Steward · /cleaning"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{total} records</strong> in queue ·{" "}
            <strong style={{ color: "var(--mn-pos)" }}>{summary.auto} auto-approved</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{summary.review} need review</strong>.
          </>
        }
        actions={
          <button
            type="button"
            className="mn-btn mn-btn-primary"
            onClick={() => setAutoOpen(true)}
            disabled={runAuto.isPending}
          >
            {runAuto.isPending ? "Running…" : "Run auto-jobs"}
          </button>
        }
      />

      <ConfirmDialog
        open={autoOpen}
        onOpenChange={setAutoOpen}
        title="Run auto-approval jobs"
        confirmLabel="Run auto-jobs"
        body={
          <>
            This approves up to 100 cleaning jobs whose confidence clears the
            auto-approval threshold and applies their corrections. Jobs below the
            threshold stay in the review queue.
          </>
        }
        onConfirm={() => runAuto.mutate()}
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="In queue" value={summary.queued} hint={`${summary.review} need review`} />
        <KPI label="Auto-approved" value={summary.auto} tone="pos" />
        <KPI label="Needs review" value={summary.review} tone="warn" />
        <KPI label="Mean confidence" value={items.length ? `${Math.round((items.reduce((a, i) => a + i.confidence, 0) / items.length) * 100)}%` : "—"} />
      </div>

      <div className="mn-segment" style={{ marginBottom: 12 }}>
        {(["all", "auto", "review"] as const).map((k) => (
          <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>
            {k === "all" ? "All" : k === "auto" ? "Auto-applied" : "Needs review"}
          </button>
        ))}
      </div>

      <div className="mn-cleaning-list">
        {items.map((j) => {
          const bucket = statusToBucket(j.status);
          return (
            <div key={j.id} className={`mn-cleaning ${bucket === "auto" ? "auto" : ""}`}>
              <div className="mn-cleaning-head">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className={`mn-clean-badge ${bucket === "auto" ? "auto" : "review"}`}>
                    {bucket === "auto" ? "AUTO" : "REVIEW"}
                  </span>
                  <span
                    className="mn-tabular"
                    style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {j.id.slice(0, 8)}
                  </span>
                  <ModChip>{j.object_type}</ModChip>
                  <span
                    style={{
                      font: "500 11.5px/1 'JetBrains Mono', monospace",
                      color: "var(--mn-ink-400)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    confidence {Math.round(j.confidence * 100)}%
                  </span>
                </div>
                <button
                  type="button"
                  className="mn-icon-btn"
                  aria-label="Copy job ID"
                  onClick={() => copyToClipboard(j.id, "Job ID copied")}
                >
                  <MoreH size={14} />
                </button>
              </div>
              <div className="mn-cleaning-body">
                <div className="mn-cleaning-title">{j.record_key}</div>
                <div className="mn-cleaning-meta">
                  <span style={{ color: "var(--mn-ink-500)" }}>
                    detected {relativeTime(j.detected_at)}
                  </span>
                </div>
              </div>
              <div className="mn-cleaning-preview">
                <span className="lbl">Preview</span>
                <span className="text">{previewLine(j)}</span>
              </div>
              <div className="mn-cleaning-actions">
                {bucket === "auto" ? (
                  <>
                    <span
                      style={{
                        font: "500 11.5px/1 'JetBrains Mono', monospace",
                        color: "var(--mn-pos)",
                        letterSpacing: "0.04em",
                      }}
                    >
                      ✓ Auto-applied
                    </span>
                    <button
                      type="button"
                      className="mn-btn mn-btn-ghost"
                      onClick={() => rollback.mutate(j.id)}
                      disabled={rollback.isPending}
                    >
                      {rollback.isPending ? "Rolling back…" : "Roll back"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="mn-btn mn-btn-ghost"
                      onClick={() => reject.mutate(j.id)}
                      disabled={reject.isPending}
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      className="mn-btn mn-btn-primary"
                      onClick={() => approve.mutate(j.id)}
                      disabled={approve.isPending}
                    >
                      Approve <ArrowRight size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
            No cleaning jobs match this filter.
          </div>
        )}
      </div>
    </>
  );
}
