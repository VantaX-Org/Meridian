"use client";

// frontend/design/primitives/ScoreExplainer.tsx
import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { Pill, type PillTone } from "./Pill";
import { ScoreRing, formatScore } from "./ScoreRing";
import { IconInfo } from "../icons";
import { Mono } from "./Mono";
import { HelpHint } from "./HelpHint";
import { buildDrillHref } from "../shell/DrillLink";

export interface ScoreDimension {
  name: string;
  weight: number;
  score: number;
}

export interface ScoreRule {
  ruleId: string;
  object: string;
  recordsFailed: number;
  weight: number;
}

/** What `Score size="md" explain` opens: the band, the weighted inputs, the cap reason and the rules costing the most. */
export interface ScoreExplanation {
  band: { label: string; tone: PillTone };
  dimensions: ScoreDimension[];
  /** Why a critical failure capped the composite (the cap value is `Score`'s `cap`). */
  capReason?: string;
  rules: ScoreRule[];
  historyHref: string;
  run?: string;
}

/**
 * Internal to `Score`: the breakdown popover. At md its trigger is the ring; at hero size (`label`) it is the score's
 * label and its info glyph, so the number is drawn once. The popover names the band and the cap; it does not draw the
 * score again.
 */
export function ScoreExplainer({ score, cap, band, dimensions, capReason, rules, historyHref, run, label }: ScoreExplanation & {
  score: number;
  cap?: number;
  /** Hero: the label the trigger reads as ("Data quality score"), with the info glyph after it. */
  label?: string;
}) {
  const top = [...rules].sort((a, b) => b.recordsFailed * b.weight - a.recordsFailed * a.weight).slice(0, 5);
  return (
    <Popover.Root>
      {label ? (
        <Popover.Trigger
          className="m-motion-colors inline-flex max-w-full items-center gap-1 rounded m-text-meta [color:var(--m-hero-ink-2)] hover:[color:var(--m-accent)]"
          aria-label={`${label} ${formatScore(score)}: how it is scored`}
          data-testid="score-explain"
        >
          {/* The hero tile prints the label beneath this trigger; this copy only holds its width, so the glyph follows it. */}
          <span aria-hidden className="truncate [color:transparent]">{label}</span>
          <IconInfo size={14} aria-hidden />
        </Popover.Trigger>
      ) : (
        <Popover.Trigger className="inline-flex items-center gap-2 rounded" aria-label={`Explain score ${formatScore(score)}`}>
          <ScoreRing score={score} size={48} cap={cap} />
        </Popover.Trigger>
      )}
      <Popover.Portal>
        <Popover.Positioner sideOffset={8} className="z-50">
          <Popover.Popup
            className="m-motion-scale-in rounded p-4 m-text-body"
            style={{ background: "var(--m-sheet)", color: "var(--m-ink)", boxShadow: "var(--m-elev-2)", width: 360, maxWidth: "calc(100vw - 32px)" }}
          >
            <div className="flex items-center gap-3">
              <span className="m-text-h font-semibold">Score breakdown</span>
              <Pill tone={band.tone}>{band.label}</Pill>
            </div>
            <table className="mt-3 w-full text-left tabular-nums">
              <thead style={{ color: "var(--m-ink-3)" }}>
                <tr><th><span className="inline-flex items-center gap-1">Dimension<HelpHint term="dimension" /></span></th><th>Weight</th><th>Score</th><th>Contribution</th></tr>
              </thead>
              <tbody>
                {dimensions.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td>{Math.round(d.weight * 100)}%</td>
                    <td>{formatScore(d.score)}</td>
                    <td>{(d.weight * d.score).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {cap != null && score > cap && <p className="mt-2 flex items-center gap-1" style={{ color: "var(--m-ink-2)" }}>Capped at {formatScore(cap)}{capReason ? `: ${capReason}` : ""}<HelpHint term="cap" /></p>}
            {top.length > 0 && (
              <>
                <p className="mt-3" style={{ color: "var(--m-ink-3)" }}>Rules costing the most</p>
                <ul>
                  {top.map((r) => (
                    <li key={r.ruleId}>
                      <Link href={buildDrillHref({ object: r.object, ruleId: r.ruleId, run })} className="m-ink-accent underline underline-offset-2">
                        <Mono>{r.ruleId}</Mono>
                      </Link>{" "}
                      <span className="tabular-nums" style={{ color: "var(--m-ink-2)" }}>{r.recordsFailed.toLocaleString()} records</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <Link href={historyHref} className="mt-3 inline-block m-ink-accent underline underline-offset-2">Score history</Link>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
