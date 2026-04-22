/**
 * Aurora WS5 signature-moments gallery.
 *
 * Exercises every moment §12 of the spec calls out — VerdictCard (01),
 * ProcessGraphEmergence (02), FixPlaybook (03), BulkActionPanel (04),
 * ArrivalBanner (05), AskStreamingCard (06), RowHoverPreview (07),
 * KanbanDrop (08), ConnectionTestButton (09), SavedViewChip (10),
 * EmptyState (11), Palette-open (12 — shipped in WS4 shell gallery).
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrivalBanner,
  AskStreamingCard,
  type AskStatus,
  BulkActionPanel,
  Button,
  Chip,
  ConnectionTestButton,
  type ConnectionTestState,
  EmptyState,
  FixPlaybook,
  type FixStep,
  KanbanDrop,
  KpiRail,
  ProcessGraph,
  ProcessGraphEmergence,
  RowHoverPreview,
  SavedViewChip,
  Stack,
  Stat,
  Text,
  VerdictCard,
} from "@/components/aurora";
import { auroraSapIcons } from "@/lib/aurora/icons";

const SAMPLE_ANSWER =
  "DQS dipped to 78.4 because Business Partner completeness fell 3.1 points in the last 24 hours. Two open findings are blocking Order-to-Cash readiness; both are single-record fixes.";

type StreamState = { text: string; status: AskStatus };

/**
 * Stream `target` into state over ~1s. `active` remounts the stream when
 * flipped true; flipping false pauses mid-stream. Deferring the reset
 * to the first tick of the interval keeps the effect body free of
 * synchronous `setState` calls (React compiler happier).
 */
function useStreamingAnswer(target: string, active: boolean): StreamState {
  const [state, setState] = useState<StreamState>({ text: "", status: "idle" });
  useEffect(() => {
    if (!active) return;
    let i = 0;
    let started = false;
    const id = window.setInterval(() => {
      if (!started) {
        started = true;
        setState({ text: "", status: "streaming" });
        return;
      }
      i += 3;
      if (i >= target.length) {
        setState({ text: target, status: "done" });
        window.clearInterval(id);
      } else {
        setState({ text: target.slice(0, i), status: "streaming" });
      }
    }, 32);
    return () => window.clearInterval(id);
  }, [active, target]);
  return state;
}

const PROCESS_NODES = [
  {
    id: "extract",
    data: {
      label: "Extract",
      kind: "source" as const,
      alignment: "aligned" as const,
      secondary: "ECC + S/4HC",
    },
  },
  {
    id: "score",
    data: {
      label: "Score",
      kind: "transform" as const,
      alignment: "aligned" as const,
      secondary: "DQ engine",
    },
  },
  {
    id: "align",
    data: {
      label: "Align",
      kind: "decision" as const,
      alignment: "drifting" as const,
      secondary: "SPRO reader",
    },
  },
  {
    id: "remediate",
    data: {
      label: "Remediate",
      kind: "approval" as const,
      alignment: "blocked" as const,
      secondary: "Workbench",
    },
  },
  {
    id: "report",
    data: {
      label: "Report",
      kind: "sink" as const,
      alignment: "aligned" as const,
      secondary: "Command Centre",
    },
  },
];

const PROCESS_EDGES = [
  { id: "e1", source: "extract", target: "score" },
  { id: "e2", source: "score", target: "align" },
  { id: "e3", source: "align", target: "remediate" },
  { id: "e4", source: "remediate", target: "report" },
];

export default function MomentsPlaygroundPage() {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["r-02", "r-05", "r-09"]),
  );
  const [savedView, setSavedView] = useState<string>("open-critical");
  const [askOn, setAskOn] = useState(true);
  const { text: streamText, status: streamStatus } = useStreamingAnswer(
    SAMPLE_ANSWER,
    askOn,
  );
  const [conn, setConn] = useState<ConnectionTestState>("idle");
  const [fixSteps, setFixSteps] = useState<FixStep[]>(() => initialSteps());
  const [graphKey, setGraphKey] = useState(0);
  const [kanban, setKanban] = useState<{
    todo: string[];
    doing: string[];
    done: string[];
  }>(() => ({
    todo: ["Reconcile GL plant 1010", "Close duplicate BP"],
    doing: ["Enrich MARA missing UoM"],
    done: ["Merge vendor 58213"],
  }));

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const runStep = useCallback((id: string) => {
    setFixSteps((prev) => {
      const next = prev.map((s) =>
        s.id === id ? { ...s, status: "running" as const } : s,
      );
      window.setTimeout(() => {
        setFixSteps((p) =>
          p.map((s) => (s.id === id ? { ...s, status: "done" } : s)),
        );
      }, 900);
      return next;
    });
  }, []);

  const testConnection = useCallback(() => {
    setConn("testing");
    window.setTimeout(() => setConn("success"), 700);
  }, []);

  const onDrop = useCallback(
    (column: "todo" | "doing" | "done") =>
      (event: React.DragEvent<HTMLElement>) => {
        const card = event.dataTransfer.getData("text/plain");
        if (!card) return;
        setKanban((prev) => {
          const next = {
            todo: prev.todo.filter((c) => c !== card),
            doing: prev.doing.filter((c) => c !== card),
            done: prev.done.filter((c) => c !== card),
          };
          next[column] = [...next[column], card];
          return next;
        });
      },
    [],
  );

  const savedViews = useMemo(
    () => [
      { id: "open-critical", label: "Open · Critical", count: 12 },
      { id: "stale-7d", label: "Stale > 7 days", count: 46 },
      { id: "mine", label: "Mine", count: 8 },
    ],
    [],
  );

  return (
    <div className="aurora-surface" data-theme="dark" style={{ padding: 24 }}>
      <Stack direction="column" gap={6}>
        <header>
          <Text variant="text-micro" tone="tertiary">
            WS5 · signature moments
          </Text>
          <Text variant="display-sm">Every moment, on one page</Text>
          <Text variant="text-body" tone="secondary">
            Hand-driven examples for VerdictCard, Fix Playbook, Bulk actions,
            Arrival banner, Ask streaming, Row hover preview, Kanban drop,
            Connection test, Saved views, Empty states, and Process-graph
            emergence. ⌘K palette is covered on the{" "}
            <a href="/_design-playground/shell">shell gallery</a>.
          </Text>
        </header>

        {!bannerDismissed ? (
          <ArrivalBanner
            eyebrow="Welcome to Meridian"
            title="You have 3 blocking findings across Order-to-Cash."
            body="Two are auto-fixable; one needs a steward review. Start with the Fix Playbook."
            actions={
              <Button size="sm" variant="primary">
                Open Workbench
              </Button>
            }
            onDismiss={() => setBannerDismissed(true)}
          />
        ) : null}

        {/* --- 01 VerdictCard + metrics rail ---------------------------- */}
        <section>
          <SectionLabel index={1} label="VerdictCard (halo — the one gradient)" />
          <VerdictCard
            eyebrow="Order-to-Cash · blocked"
            semantic="danger"
            verdict="Two single-record fixes are blocking the Q1 close."
            support="Business Partner completeness fell 3.1 pts in the last 24 hours. Both findings are auto-fixable from the drawer."
            metrics={
              <KpiRail>
                <Stat label="DQS" value="78.4" />
                <Stat label="Open · critical" value={12} />
                <Stat label="Auto-fixable" value={9} />
                <Stat label="Systems" value="7 / 7" />
              </KpiRail>
            }
            actions={
              <>
                <Button size="md" variant="primary">
                  Open drawer · BP 58213
                </Button>
                <Button size="md" variant="ghost">
                  Explain verdict
                </Button>
              </>
            }
          />
        </section>

        {/* --- 02 ProcessGraphEmergence ---------------------------------- */}
        <section>
          <SectionLabel
            index={2}
            label="ProcessGraphEmergence (stagger on mount)"
            trailing={
              <Button size="sm" variant="ghost" onClick={() => setGraphKey((k) => k + 1)}>
                Replay
              </Button>
            }
          />
          <ProcessGraphEmergence remountKey={graphKey}>
            <div style={{ height: 240 }}>
              <ProcessGraph
                nodes={PROCESS_NODES}
                edges={PROCESS_EDGES}
                direction="LR"
              />
            </div>
          </ProcessGraphEmergence>
        </section>

        {/* --- 03 FixPlaybook ------------------------------------------- */}
        <section>
          <SectionLabel index={3} label="FixPlaybook (record drawer)" />
          <FixPlaybook
            title="Fix Business Partner 58213"
            steps={fixSteps.map((s) => ({ ...s, onRun: () => runStep(s.id) }))}
          />
        </section>

        {/* --- 04/05 Bulk + arrival -------------------------------------- */}
        <section>
          <SectionLabel index={4} label="BulkActionPanel (appears on selection)" />
          <Stack direction="column" gap={3}>
            <Stack direction="row" gap={2}>
              {["r-01", "r-02", "r-03", "r-05", "r-09"].map((id) => (
                <Chip
                  key={id}
                  selected={selected.has(id)}
                  onClick={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                >
                  {id}
                </Chip>
              ))}
            </Stack>
            <BulkActionPanel
              selectedCount={selected.size}
              onClear={clearSelection}
              actions={
                <>
                  <Button size="sm" variant="secondary">
                    Assign steward…
                  </Button>
                  <Button size="sm" variant="primary">
                    Auto-fix · {selected.size}
                  </Button>
                </>
              }
            />
          </Stack>
        </section>

        {/* --- 06 Ask streaming ----------------------------------------- */}
        <section>
          <SectionLabel
            index={6}
            label="AskStreamingCard (tokens are the progress indicator)"
            trailing={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAskOn((v) => !v)}
              >
                Restream
              </Button>
            }
          />
          <AskStreamingCard
            question="Why did DQS drop overnight?"
            answer={streamText || " "}
            status={streamStatus}
            citations={[
              { id: "f-12", label: "Finding BP-03 · completeness", kind: "finding" },
              { id: "f-17", label: "Finding MARA-11 · validity", kind: "finding" },
              { id: "r-58213", label: "BP 58213", kind: "record" },
            ]}
          />
        </section>

        {/* --- 07 RowHoverPreview --------------------------------------- */}
        <section>
          <SectionLabel index={7} label="RowHoverPreview (hover / focus → popover)" />
          <div
            style={{
              border: "1px solid var(--aurora-canvas-line)",
              borderRadius: 12,
              padding: 12,
              background: "var(--aurora-canvas-raised)",
            }}
          >
            {["BP 58213 · Acme Pty", "MARA 10041 · UoM missing", "ITEM 90213 · GL 61010"].map(
              (label) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "8px 4px",
                  }}
                >
                  <RowHoverPreview
                    preview={
                      <Stack direction="column" gap={1}>
                        <Text variant="text-micro" tone="tertiary">
                          Quick look
                        </Text>
                        <Text variant="text-body">{label}</Text>
                        <Text variant="text-small" tone="secondary">
                          3 open findings · last touched 2 h ago
                        </Text>
                      </Stack>
                    }
                  >
                    <button
                      type="button"
                      className="aurora-focus-ring"
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--aurora-ink-100)",
                        cursor: "pointer",
                        padding: "4px 6px",
                        borderRadius: 6,
                      }}
                    >
                      {label}
                    </button>
                  </RowHoverPreview>
                </div>
              ),
            )}
          </div>
        </section>

        {/* --- 08 KanbanDrop -------------------------------------------- */}
        <section>
          <SectionLabel index={8} label="KanbanDrop (accept / reject + pulse)" />
          <Stack direction="row" gap={3}>
            {(["todo", "doing", "done"] as const).map((col) => (
              <KanbanDrop
                key={col}
                title={col.toUpperCase()}
                canAccept
                onDrop={onDrop(col)}
              >
                {kanban[col].map((card) => (
                  <div
                    key={card}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", card);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    style={{
                      padding: "8px 10px",
                      border: "1px solid var(--aurora-canvas-line)",
                      borderRadius: 8,
                      background: "var(--aurora-canvas-raised)",
                      cursor: "grab",
                    }}
                  >
                    <Text variant="text-small">{card}</Text>
                  </div>
                ))}
              </KanbanDrop>
            ))}
          </Stack>
        </section>

        {/* --- 09 ConnectionTest ---------------------------------------- */}
        <section>
          <SectionLabel index={9} label="ConnectionTestButton (testing → success pulse)" />
          <Stack direction="row" gap={3} align="center">
            <ConnectionTestButton state={conn} onTest={testConnection} />
            <Button size="sm" variant="ghost" onClick={() => setConn("idle")}>
              Reset
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConn("error")}
            >
              Force error
            </Button>
          </Stack>
        </section>

        {/* --- 10 SavedViewChip ---------------------------------------- */}
        <section>
          <SectionLabel index={10} label="SavedViewChip (recall + delete)" />
          <Stack direction="row" gap={2}>
            {savedViews.map((v) => (
              <SavedViewChip
                key={v.id}
                label={v.label}
                count={v.count}
                active={savedView === v.id}
                onClick={() => setSavedView(v.id)}
                onDelete={() => undefined}
              />
            ))}
          </Stack>
        </section>

        {/* --- 11 EmptyState ------------------------------------------- */}
        <section>
          <SectionLabel index={11} label="EmptyState (per-surface, SAP iconography)" />
          <EmptyState
            icon={<auroraSapIcons.workflowNode width={32} height={32} />}
            title="No findings for this filter"
            body="Widen the severity filter or clear saved view to see more."
            actions={
              <>
                <Button size="sm" variant="ghost">
                  Clear filter
                </Button>
                <Button size="sm" variant="primary">
                  Open Ask
                </Button>
              </>
            }
          />
        </section>
      </Stack>
    </div>
  );
}

function SectionLabel({
  index,
  label,
  trailing,
}: {
  index: number;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
      }}
    >
      <Stack direction="row" gap={2} align="center">
        <Text variant="text-micro" tone="tertiary">
          {String(index).padStart(2, "0")}
        </Text>
        <Text variant="text-lead">{label}</Text>
      </Stack>
      {trailing}
    </div>
  );
}

function initialSteps(): FixStep[] {
  return [
    {
      id: "s1",
      label: "Confirm duplicate BP 58214",
      status: "done",
      detail: "Matched by tax ID + address.",
    },
    {
      id: "s2",
      label: "Merge into BP 58213",
      status: "pending",
      detail: "Transactional chain auto-rewired.",
    },
    {
      id: "s3",
      label: "Backfill missing fields",
      status: "pending",
      detail: "5 NULL fields across Address 1 + Address 2.",
    },
    {
      id: "s4",
      label: "Re-run DQ check",
      status: "blocked",
      detail: "Awaiting steward approval.",
    },
  ];
}
