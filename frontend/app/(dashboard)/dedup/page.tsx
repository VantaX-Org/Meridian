"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI } from "@/components/meridian/atoms";
import { ArrowRight } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getDedupCandidates,
  mergeDedupCandidate,
  type DedupCandidate,
} from "@/lib/api/cleaning";
import { SearchField, matchesSearch, ConfirmDialog } from "@/components/meridian/controls";
import { relativeTime } from "@/lib/format";

const OBJECT_TYPES = ["vendor", "customer", "material"] as const;
type ObjectType = (typeof OBJECT_TYPES)[number];

const KIND_PALETTE: Record<string, { bg: string; fg: string }> = {
  vendor:   { bg: "var(--mn-primary-50)",  fg: "var(--mn-primary-700)" },
  customer: { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED" },
  material: { bg: "rgba(14,165,164,0.12)", fg: "#0EA5A4" },
};

function ScoreRing({ value }: { value: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const col = value >= 0.95 ? "var(--mn-pos)" : value >= 0.85 ? "var(--mn-primary)" : "var(--mn-warn)";
  return (
    <div style={{ position: "relative", width: 54, height: 54 }}>
      <svg width="54" height="54" viewBox="0 0 54 54" aria-hidden="true">
        <circle cx="27" cy="27" r={r} fill="none" stroke="rgba(15,23,42,0.08)" strokeWidth="5" />
        <circle
          cx="27"
          cy="27"
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          transform="rotate(-90 27 27)"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          font: "700 13px/1 'JetBrains Mono', monospace",
          color: col,
        }}
      >
        {Math.round(value * 100)}
      </span>
    </div>
  );
}

export default function DedupPage() {
  const qc = useQueryClient();
  const [kind, setKind] = useState<"all" | ObjectType>("all");
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Which record survives a merge, per candidate id. Defaults to "a" (the
  // record the backend lists first); the steward can swap before approving.
  const [survivors, setSurvivors] = useState<Record<string, "a" | "b">>({});

  const survivorKeyFor = (p: DedupCandidate) =>
    (survivors[p.id] ?? "a") === "a" ? p.record_key_a : p.record_key_b;

  // Backend endpoint requires an object_type, so we fan out one query per
  // type and merge the results. When a specific tab is active we still
  // issue all three but only display the active one.
  const queries = useQueries({
    queries: OBJECT_TYPES.map((t) => ({
      queryKey: ["dedup.candidates", t],
      queryFn: () => getDedupCandidates({ object_type: t, status: "open" }),
    })),
  });

  const merge = useMutation({
    mutationFn: ({ candidate, survivorKey }: { candidate: DedupCandidate; survivorKey: string }) =>
      mergeDedupCandidate({ candidate_id: candidate.id, survivor_key: survivorKey }),
    onSuccess: (_d, vars) => {
      toast.success(`Merged into ${vars.survivorKey}`);
      qc.invalidateQueries({ queryKey: ["dedup.candidates"] });
    },
    onError: () => toast.error("Could not merge records"),
  });

  const bulkMerge = useMutation({
    mutationFn: async (cands: DedupCandidate[]) => {
      const results = await Promise.allSettled(
        cands.map((c) =>
          mergeDedupCandidate({ candidate_id: c.id, survivor_key: survivorKeyFor(c) }),
        ),
      );
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (ok) => {
      toast.success(`Merged ${ok} pair${ok === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["dedup.candidates"] });
    },
    onError: () => toast.error("Could not bulk merge"),
  });

  const loading = queries.some((q) => q.isLoading);
  const error = queries.find((q) => q.error)?.error;

  const allItems = useMemo<{ candidate: DedupCandidate; kind: ObjectType }[]>(() => {
    const out: { candidate: DedupCandidate; kind: ObjectType }[] = [];
    OBJECT_TYPES.forEach((t, i) => {
      const items = queries[i]?.data?.items ?? [];
      for (const c of items) out.push({ candidate: c, kind: t });
    });
    return out;
  }, [queries]);

  if (loading && allItems.length === 0) {
    return (
      <>
        <PageHead title="Dedup" route="Steward · /dedup" sub="Loading dedup queue…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }

  if (error && allItems.length === 0) {
    return (
      <>
        <PageHead title="Dedup" route="Steward · /dedup" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/dedup/candidates/&lt;type&gt;</code>.
        </div>
      </>
    );
  }

  const filtered = allItems
    .filter((x) => kind === "all" || x.kind === kind)
    .filter((x) => matchesSearch(x.candidate, search));
  const totalPairs = allItems.length;
  const highConfidence = filtered
    .filter((x) => x.candidate.match_score >= 0.95)
    .map((x) => x.candidate);
  const counts = {
    vendor: allItems.filter((x) => x.kind === "vendor").length,
    customer: allItems.filter((x) => x.kind === "customer").length,
    material: allItems.filter((x) => x.kind === "material").length,
  };
  const meanScore = allItems.length
    ? Math.round(
        (allItems.reduce((a, x) => a + x.candidate.match_score, 0) / allItems.length) * 100,
      )
    : null;

  return (
    <>
      <PageHead
        title="Dedup"
        route="Steward · /dedup"
        sub={
          <>
            <strong style={{ color: "var(--mn-warn)" }}>{totalPairs} duplicate pairs</strong> awaiting review.
            {meanScore !== null && (
              <>
                {" "}Mean match score: <strong style={{ color: "var(--mn-pos)" }}>{meanScore}%</strong>.
              </>
            )}
          </>
        }
        actions={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Filter pairs…" />
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={() => {
                if (highConfidence.length === 0) {
                  toast.info("No pairs above 95% match to bulk merge");
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={bulkMerge.isPending}
            >
              {bulkMerge.isPending ? "Merging…" : "Bulk merge"}
            </button>
          </>
        }
      />

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Bulk merge high-confidence pairs"
        danger
        confirmLabel={`Merge ${highConfidence.length} pair${highConfidence.length === 1 ? "" : "s"}`}
        body={
          <>
            This merges {highConfidence.length} duplicate pair
            {highConfidence.length === 1 ? "" : "s"} with a match score of 95% or higher.
            Each merge keeps the survivor record currently selected on its card and
            retires the other. This cannot be undone in bulk.
          </>
        }
        onConfirm={() => bulkMerge.mutate(highConfidence)}
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Pairs queued" value={totalPairs} tone="warn" />
        <KPI label="Vendor" value={counts.vendor} />
        <KPI label="Customer" value={counts.customer} />
        <KPI label="Material" value={counts.material} />
      </div>

      <div className="mn-segment" style={{ marginBottom: 12 }}>
        <button type="button" className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>
          All <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>{totalPairs}</span>
        </button>
        {OBJECT_TYPES.map((k) => (
          <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => setKind(k)}>
            {k[0].toUpperCase() + k.slice(1)}{" "}
            <span className="mn-tabular" style={{ opacity: 0.6, marginLeft: 4 }}>
              {counts[k]}
            </span>
          </button>
        ))}
      </div>

      <div className="mn-dedup-grid">
        {filtered.map(({ candidate: p, kind: k }) => {
          const tn = KIND_PALETTE[k];
          const survivor = survivors[p.id] ?? "a";
          return (
            <div key={p.id} className="mn-dedup-card">
              <div className="mn-dedup-head">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      display: "inline-flex",
                      padding: "3px 8px",
                      borderRadius: 4,
                      background: tn.bg,
                      color: tn.fg,
                      font: "700 10px/1 'JetBrains Mono', monospace",
                      letterSpacing: "0.1em",
                    }}
                  >
                    {k.toUpperCase()}
                  </span>
                  <span
                    className="mn-tabular"
                    style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                  >
                    {p.id.slice(0, 8)}
                  </span>
                </div>
                <ScoreRing value={p.match_score} />
              </div>

              <div className="mn-dedup-pair">
                <div className={survivor === "a" ? "rec primary" : "rec dup"}>
                  <div className="mn-eyebrow">{survivor === "a" ? "Keep (survivor)" : "Merge from"}</div>
                  <div className="name">{p.record_key_a}</div>
                  <div className="meta">
                    <span className="mn-tabular">{p.match_method}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="merge-arrow"
                  onClick={() =>
                    setSurvivors((prev) => ({ ...prev, [p.id]: survivor === "a" ? "b" : "a" }))
                  }
                  title="Swap survivor"
                  aria-label="Swap which record survives the merge"
                  style={{ background: "none", border: 0, cursor: "pointer" }}
                >
                  <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
                    <path d="M 6 12 L 26 12" fill="none" stroke="var(--mn-primary)" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="m 22 8 4 4 -4 4" fill="none" stroke="var(--mn-primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M 26 20 L 6 20" fill="none" stroke="var(--mn-primary)" strokeWidth="1.6" strokeLinecap="round" />
                    <path d="m 10 16 -4 4 4 4" fill="none" stroke="var(--mn-primary)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className={survivor === "b" ? "rec primary" : "rec dup"}>
                  <div className="mn-eyebrow">{survivor === "b" ? "Keep (survivor)" : "Merge from"}</div>
                  <div className="name">{p.record_key_b}</div>
                  <div className="meta">
                    <span className="mn-tabular">{relativeTime(p.created_at)}</span>
                  </div>
                </div>
              </div>

              {p.match_fields && Object.keys(p.match_fields).length > 0 && (
                <div className="mn-dedup-signals">
                  <span className="mn-eyebrow">Signals</span>
                  <div className="mn-chip-row">
                    {Object.keys(p.match_fields).slice(0, 6).map((s) => (
                      <span
                        key={s}
                        style={{
                          display: "inline-flex",
                          padding: "3px 7px",
                          borderRadius: 3,
                          background: "var(--mn-pos-bg)",
                          color: "var(--mn-pos)",
                          font: "600 10.5px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.04em",
                        }}
                      >
                        ✓ {s.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="mn-dedup-actions">
                <span
                  style={{
                    flex: 1,
                    font: "500 11.5px/1.4 'JetBrains Mono', monospace",
                    color: "var(--mn-ink-400)",
                    letterSpacing: "0.03em",
                  }}
                >
                  Survivor: {survivorKeyFor(p)}
                </span>
                <button
                  type="button"
                  className="mn-btn mn-btn-primary"
                  onClick={() =>
                    merge.mutate({ candidate: p, survivorKey: survivorKeyFor(p) })
                  }
                  disabled={merge.isPending}
                >
                  {merge.isPending ? "Merging…" : "Approve merge"} <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
            No open duplicate pairs in this domain.
          </div>
        )}
      </div>
    </>
  );
}
