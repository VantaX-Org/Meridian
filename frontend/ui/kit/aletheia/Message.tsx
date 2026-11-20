"use client";

import { useState } from "react";
import Link from "next/link";
import { createRuleBatch, markActed } from "@/lib/api/v2/insights";
import { t } from "@/lib/v2/i18n";
import { BarList } from "../BarList";
import { Confirm } from "../Confirm";
import { FieldChip } from "../FieldChip";
import { StatTile } from "../StatTile";
import { TrendArea } from "../TrendArea";
import type { ChatMessage } from "../AletheiaSheet";
import { pickViz, sourcesOf, type Viz } from "./pickViz";
import "./aletheia.css";

type Pending = { kind: "batch" | "acted"; module: string; check_id: string } | null;

/** One answer: text, inline chart, the facts it rests on with their codes, a grounding footer and action chips. */
export function Message({ m, evidenceLabel, onAsk }: { m: ChatMessage; evidenceLabel: string; onAsk: (q: string) => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState<string | null>(null);
  const first = m.facts?.find((f) => f.checks[0])?.checks[0];
  const run = async () => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    try {
      if (p.kind === "batch") await createRuleBatch(`${p.check_id} ${t("fix batch")}`, { module: p.module, check_id: p.check_id });
      else await markActed({ module: p.module, check_id: p.check_id, action: "cleanse" });
      setNote(p.kind === "batch" ? t("Fix batch created.") : t("Marked as acted on."));
    } catch {
      setNote(t("That did not go through. Try again."));
    }
  };
  const mod = first?.module ?? "";
  const sources = sourcesOf(m.facts ?? []);
  return (
    <div className="mx-msg" data-role={m.role}>
      {m.text ? <p>{m.text}</p> : m.pending ? <p className="mx-ans-pending">{t("Aletheia is reading the figures.")}</p> : null}
      <LeadViz viz={pickViz({ grounded: m.grounded ?? true, intent: m.intent ?? "", chart: m.chart?.kind ?? null, data: m.chart?.data ?? null })} />
      {m.facts?.length ? (
        <div>
          <p className="mx-evidence-l">{evidenceLabel}</p>
          <ul className="mx-ans-facts" aria-label={evidenceLabel}>
            {m.facts.map((f) => (
              <li key={f.statement}>
                {f.checks[0] ? <FieldChip code={f.checks[0].check_id} description={f.statement.replace(f.checks[0].check_id, "").trim() || undefined} /> : <span>{f.statement}</span>}
                {f.value != null ? <span>{t("{n} records", { n: f.value })}</span> : null}
                {f.href ? <Link href={f.href} className="mx-link">{t("Open records")}</Link> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {sources.length ? (
        <div><p className="mx-evidence-l">{t("Read from")}</p><ul className="mx-evidence" aria-label={t("Read from")}>{sources.map((g) => <li key={g.source}><code>{g.source}</code> {t("{n} facts, {r} rules", { n: g.n, r: g.checks.length })}</li>)}</ul></div>
      ) : null}
      {m.evidence?.length ? (
        <div><p className="mx-evidence-l">{evidenceLabel}</p><ul className="mx-evidence" aria-label={evidenceLabel}>{m.evidence.map((x) => <li key={x}>{x}</li>)}</ul></div>
      ) : null}
      {m.footer ? (
        <p className="mx-ans-foot" data-warn={m.footer.coverage < 1 ? "true" : undefined}>
          {m.footer.coverage < 1
            ? t("Only {pct}% of the figures behind this answer were found.", { pct: Math.round(m.footer.coverage * 100) })
            : m.footer.phrased ? t("Reworded by the model") : t("Grounded in {n} facts", { n: m.footer.n })}
        </p>
      ) : null}
      {m.actions?.length || first || m.links?.length ? (
        <div className="mx-chips">
          {m.actions?.map((a) => a.href
            ? <Link key={a.id} href={a.href} className="mx-chip-btn">{a.label}</Link>
            : <button key={a.id} type="button" className="mx-chip-btn" onClick={a.onClick}>{a.label}</button>)}
          {m.links?.map((l) => <Link key={l.href} href={l.href} className="mx-chip-btn">{l.label}</Link>)}
          {first ? <button type="button" className="mx-chip-btn" onClick={() => onAsk(t("Explain rule {rule}", { rule: first.check_id }))}>{t("Explain rule")}</button> : null}
          {first && mod ? <button type="button" className="mx-chip-btn" onClick={() => setPending({ kind: "batch", module: mod, check_id: first.check_id })}>{t("Create fix batch")}</button> : null}
          {first && mod ? <button type="button" className="mx-chip-btn" onClick={() => setPending({ kind: "acted", module: mod, check_id: first.check_id })}>{t("Mark acted")}</button> : null}
        </div>
      ) : null}
      {note ? <p className="mx-ans-foot" role="status">{note}</p> : null}
      <Confirm
        open={pending !== null}
        title={pending?.kind === "batch" ? t("Create a fix batch for {rule}?", { rule: pending.check_id }) : t("Mark {rule} as acted on?", { rule: pending?.check_id ?? "" })}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        onConfirm={run}
        onCancel={() => setPending(null)}
      >
        <p className="mx-muted">{t("This writes to the ledger. Nothing is sent to SAP.")}</p>
      </Confirm>
    </div>
  );
}

/** The one lead visual pickViz chose: a trend, ranked bars, a share of a total, or one or two figures. */
function LeadViz({ viz }: { viz: Viz }) {
  if (viz.kind === "none") return null;
  return (
    <div className="mx-ans-chart">
      {viz.kind === "line" ? <TrendArea label={t("Trend in the answer")} emptyLabel={t("Too few points to draw a trend.")} points={viz.points.map((d) => ({ axis: d.label, title: d.label, value: d.value }))} /> : null}
      {viz.kind === "bars" ? <>
        <BarList label={t("Figures in the answer")} items={viz.items.map((d) => ({ id: d.label, label: d.label, value: Math.abs(d.value), display: String(d.value) }))} />
        {viz.more ? <p className="mx-muted">{t("{n} more not shown", { n: viz.more })}</p> : null}
      </> : null}
      {viz.kind === "share" ? <BarList label={t("Share of {n}", { n: viz.total })} max={viz.total} items={viz.segs.map((d) => ({ id: d.label, label: d.label, value: d.value, display: `${d.value} (${Math.round((d.value / viz.total) * 100)}%)` }))} /> : null}
      {viz.kind === "stat" ? <dl className="mx-ans-stats">
        {viz.figures.map((d, i) => <StatTile key={d.label} label={d.label} value={d.value} note={i === 0 && viz.delta !== undefined ? t("{n} against the second figure", { n: viz.delta > 0 ? `+${viz.delta}` : viz.delta }) : undefined} />)}
      </dl> : null}
    </div>
  );
}
