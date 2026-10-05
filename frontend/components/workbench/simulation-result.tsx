"use client";

/**
 * Fix simulation result — what a set of proposed fixes would do to the DQS,
 * rule pass rates, findings and config impact, computed on a copy of the
 * extraction (nothing is written anywhere). Polls while the job runs; live
 * stage progress is also on the shell's job rail (kind "simulation").
 */

import { useQuery } from "@tanstack/react-query";
import type { CSSProperties, ReactNode } from "react";

import { Banner, Chip, type ChipTone, Panel, Stack, Text } from "@/components/aurora";
import {
  getSimulation,
  isSimulationResult,
  type RuleChange,
  type RuleDelta,
  type ScoreDelta,
  type SimulationResult,
} from "@/lib/api/simulation";

const TONE: Record<RuleChange, ChipTone> = {
  resolved: "success",
  improved: "success",
  regressed: "danger",
  newly_failing: "danger",
  unchanged: "neutral",
  newly_evaluated: "info",
  not_evaluated: "neutral",
};

const cell: CSSProperties = {
  padding: "var(--aurora-space-2) var(--aurora-space-3)",
  borderBottom: "1px solid var(--aurora-canvas-line)",
  textAlign: "left",
};
const num: CSSProperties = { ...cell, textAlign: "right" };

function fmt(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "–" : v.toFixed(digits);
}

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="aurora-number">–</span>;
  const tone: ChipTone = value > 0 ? "success" : value < 0 ? "danger" : "neutral";
  return (
    <Chip tone={tone}>
      <span className="aurora-number">{value > 0 ? "+" : ""}{value.toFixed(1)}</span>
    </Chip>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={i === 0 ? cell : num}>
                <Text variant="text-micro" tone="tertiary">{h}</Text>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function ScoreRows({ rows }: { rows: (ScoreDelta & { name: string })[] }) {
  return (
    <Table head={["", "Before", "After", "Change"]}>
      {rows.map((r) => (
        <tr key={r.name}>
          <td style={cell}><Text variant="text-small">{r.name}</Text></td>
          <td style={num} className="aurora-number">{fmt(r.before)}</td>
          <td style={num} className="aurora-number">{fmt(r.after)}</td>
          <td style={num}><Delta value={r.delta} /></td>
        </tr>
      ))}
    </Table>
  );
}

function RuleRows({ rows }: { rows: RuleDelta[] }) {
  return (
    <Table head={["Rule", "Failing before", "Failing after", "Pass rate after", "Status"]}>
      {rows.map((r) => (
        <tr key={`${r.module}:${r.check_id}`}>
          <td style={cell}>
            <Text variant="text-small">{r.check_id}</Text>{" "}
            <Text variant="text-micro" tone="tertiary">{r.field}</Text>
          </td>
          <td style={num} className="aurora-number">{r.before?.failing ?? "–"}</td>
          <td style={num} className="aurora-number">{r.after?.failing ?? "–"}</td>
          <td style={num} className="aurora-number">{r.after ? `${fmt(r.after.pass_rate, 2)}%` : "–"}</td>
          <td style={num}><Chip tone={TONE[r.status]}>{r.status.replace("_", " ")}</Chip></td>
        </tr>
      ))}
    </Table>
  );
}

function Result({ r }: { r: SimulationResult }) {
  const o = r.dqs.overall;
  return (
    <Stack gap={4}>
      <Stack direction="row" gap={6} wrap align="end">
        <Stack gap={1}>
          <Text variant="text-micro" tone="tertiary">DQS</Text>
          <Text variant="display-sm" className="aurora-number">
            {fmt(o.before)} to {fmt(o.after)}
          </Text>
        </Stack>
        <Delta value={o.delta} />
        {o.capped_before && !o.capped_after ? <Chip tone="success">critical cap lifted</Chip> : null}
        <Text variant="text-small" tone="secondary">
          {r.fixes.cells_changed} cells changed, {r.findings.resolved} findings resolved,{" "}
          {r.findings.introduced} introduced, {r.records.resolved} failing records cleared
          {r.fixes.unmatched_records ? `, ${r.fixes.unmatched_records} fixes matched no record` : ""}
        </Text>
      </Stack>

      {r.side_effects.length ? (
        <Banner tone="warning" title={`${r.side_effects.length} side effect(s)`}>
          These rules were not targeted but fail on more or different records after the fixes.
        </Banner>
      ) : null}

      <Panel title="Rules changed">
        {r.rules.length ? <RuleRows rows={r.rules} /> : <Text tone="secondary">No rule changed.</Text>}
        <Text variant="text-micro" tone="tertiary">{r.unchanged_rules} rules unchanged</Text>
      </Panel>

      {r.side_effects.length ? (
        <Panel title="Side effects"><RuleRows rows={r.side_effects} /></Panel>
      ) : null}

      <Stack direction="row" gap={4} wrap>
        <div style={{ flex: "1 1 320px" }}>
          <Panel title="By module">
            <ScoreRows rows={r.dqs.modules.map((m) => ({ ...m, name: m.module }))} />
          </Panel>
        </div>
        <div style={{ flex: "1 1 320px" }}>
          <Panel title="By dimension">
            <ScoreRows rows={r.dqs.dimensions.map((d) => ({ ...d, name: d.dimension }))} />
          </Panel>
        </div>
      </Stack>

      {r.impact.length ? (
        <Panel title="Config impact">
          <Table head={["Feature", "Before", "After", "Change"]}>
            {r.impact.map((f) => (
              <tr key={`${f.module}:${f.feature}`}>
                <td style={cell}><Text variant="text-small">{f.feature}</Text></td>
                <td style={num}><Text variant="text-small">{f.before}</Text></td>
                <td style={num}><Text variant="text-small">{f.after}</Text></td>
                <td style={num}>
                  <Chip tone={f.change === "worsened" ? "danger" : "success"}>{f.change}</Chip>
                </td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}

      {r.best_next_fixes?.length ? (
        <Panel title="Best next fixes">
          <Table head={["Fix", "Cells changed", "DQS gain", "Gain per 1k", "DQS after"]}>
            {r.best_next_fixes.map((f) => (
              <tr key={f.id}>
                <td style={cell}><Text variant="text-small">{f.label}</Text></td>
                <td style={num} className="aurora-number">{f.records_changed}</td>
                <td style={num} className="aurora-number">+{fmt(f.dqs_gain, 2)}</td>
                <td style={num} className="aurora-number">{fmt(f.gain_per_1k_records, 2)}</td>
                <td style={num} className="aurora-number">{fmt(f.dqs_after)}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
    </Stack>
  );
}

export function SimulationResultPanel({ simulationId }: { simulationId: string }) {
  const q = useQuery({
    queryKey: ["simulation", simulationId],
    queryFn: () => getSimulation(simulationId),
    refetchInterval: (s) => (s.state.data && isSimulationResult(s.state.data) ? false : 3000),
  });
  if (q.isError) return <Banner tone="danger" title="Simulation not found or expired" />;
  const d = q.data;
  if (!d || !isSimulationResult(d)) {
    return (
      <Panel title="Fix simulation">
        <Text tone="secondary">{d?.job.message ?? "Queued"}</Text>
      </Panel>
    );
  }
  if (d.status === "failed") return <Banner tone="danger" title="Simulation failed">{d.error}</Banner>;
  return <Result r={d} />;
}
