import { rulerGeometry, readingText, f1, DASH, type RulerSize } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";

export interface RulerProps {
  size: RulerSize;
  /** The six dimension scores in ruler order (completeness first), null for a dimension that was not measured. */
  dims: ReadonlyArray<number | null>;
  /** The score before any cap: where the tick sits. */
  measured: number | null;
  /** The shown score: capped when a cap applies. */
  score: number | null;
  capped: boolean;
  capLevel: number | null;
  /** Check ids of the critical rules over tolerance. */
  breaches: readonly string[];
  label: string;
  records: number | null;
  rules: number | null;
  /** 0 to 1 */
  coverage: number | null;
  lowConfidence?: boolean;
  /** Fills the segments in the data hue: the selected cell, the object header. */
  selected?: boolean;
  /** Shows the shown score and the word "capped" beside the bar. Default true. */
  showScore?: boolean;
  /** An object with no run: the bar is drawn empty with a dash. */
  empty?: boolean;
  /** Step 9: the data contract mark (lib/v2/step9 contractMark). One mark, filled when a breached contract is enforced. */
  contract?: { count: number; enforced: number; title: string } | null;
  /** Step 10: the policy mark (lib/v2/step10 policyMark). One shield, beside the contract diamond, never in its place. */
  policy?: { count: number; title: string } | null;
  /** The 240 ruler on a phone: short band and cap words, the plot as wide as `available` allows. */
  compact?: boolean;
  available?: number;
}

/** The policy breach mark: one filled shield. Its title and accessible name say how many applied classes are breached. */
export function PolicyMark({ mark }: { mark: { count: number; title: string } }) {
  return (
    <span className="m2-pmark" role="img" aria-label={mark.title} title={mark.title} data-testid="policy-mark">
      <svg width="10" height="11" viewBox="0 0 10 11" aria-hidden="true" focusable="false">
        <path d="M5 0.7 9.2 2.3V5.3C9.2 7.7 7.4 9.4 5 10.3 2.6 9.4 0.8 7.7 0.8 5.3V2.3Z" />
      </svg>
    </span>
  );
}

/** The contract breach mark: one diamond, outlined when the breached contracts only report, filled when one is enforced. */
export function ContractMark({ mark }: { mark: { count: number; enforced: number; title: string } }) {
  const strong = mark.enforced > 0;
  return (
    <span className="m2-cmark" data-enforced={strong ? "true" : "false"} role="img" aria-label={mark.title} title={mark.title} data-testid="contract-mark">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <path d="M5 0.9 9.1 5 5 9.1 0.9 5Z" />
      </svg>
    </span>
  );
}

/**
 * The ruler: Meridian's one drawing of a score. Six segments whose widths are the dimension weights, each filled
 * from the bottom to its score, a tick at the measured score, the shown score as a number and the word "capped"
 * when a cap applies. 48 is the bar in map rows and matrix cells; 240 adds the 0 to 100 axis with the 60, 75 and 90
 * band marks, the 70 and 85 cap ticks and the six scores under their segments. Pure SVG.
 */
export function Ruler(props: RulerProps) {
  const { size, dims, measured, score, capped, capLevel, breaches, label, selected, showScore = true, empty } = props;
  const g = rulerGeometry(size, empty ? [null, null, null, null, null, null] : dims, empty ? null : measured, { compact: props.compact, available: props.available });
  const reading = empty
    ? t("{label}: no run yet.", { label })
    : readingText({ label, measured, score, capped, capLevel, breaches, dims, records: props.records, rules: props.rules, coverage: props.coverage, lowConfidence: props.lowConfidence ?? false });
  const large = size === 240;
  const tickLeft = g.plot.left - (large ? 2 : 2);
  const tickWidth = g.plot.width + (large ? 4 : 4);
  return (
    <span className={`m2-ruler-box${large ? " m2-ruler-box-lg" : ""}`} title={reading}>
      <span className="m2-ruler-col">
        <svg
          className={`m2-ruler${selected ? " m2-on" : ""}${large ? " m2-ruler-lg" : ""}`}
          width={g.viewWidth}
          height={g.viewHeight}
          viewBox={`0 0 ${g.viewWidth} ${g.viewHeight}`}
          role="img"
          aria-label={reading}
          data-size={size}
        >
          <title>{reading}</title>
          {g.segments.map((s) => (
            <g key={s.key} className="m2-seg" data-dimension={s.key}>
              <rect className="m2-t" x={s.x} y={g.plot.top} width={s.width} height={g.plot.height} />
              <rect className="m2-f" x={s.x} y={s.fillY} width={s.width} height={s.fillHeight} />
            </g>
          ))}
          {large ? (
            <>
              <line className="m2-ax1" x1={g.plot.left - 8} x2={g.plot.left - 8} y1={g.axis.find((a) => a.value === 100)?.y} y2={g.axis.find((a) => a.value === 0)?.y} />
              {g.axis
                .filter((a) => a.kind === "scale")
                .map((a) => (
                  <line key={`s${a.value}`} className="m2-ax1" x1={g.plot.left - 11} x2={g.plot.left - 8} y1={a.y} y2={a.y} />
                ))}
              {g.axis
                .filter((a) => a.kind === "band")
                .map((a) => (
                  <line key={`b${a.value}`} className="m2-ax2" x1={g.plot.left - 8} x2={g.plot.left - 1} y1={a.y} y2={a.y} />
                ))}
              {g.axis
                .filter((a) => a.label)
                .map((a) => (
                  <text key={`t${a.kind}${a.value}`} className="m2-rt" x={g.plot.left - 14} y={a.y + 4} textAnchor="end" data-band={a.kind === "band" ? a.value : undefined}>
                    {a.title && a.title !== a.label ? <title>{a.title}</title> : null}
                    {a.label}
                  </text>
                ))}
              {g.caps.map((c) => (
                <g key={`c${c.value}`} data-cap={c.value}>
                  <line className="m2-capl" x1={g.plot.left} x2={g.plot.left + g.plot.width + 10} y1={c.y} y2={c.y} />
                  <text className="m2-rt" x={g.plot.left + g.plot.width + 14} y={(g.labels.find((l) => l.kind === "cap" && l.text === c.label)?.y ?? c.y - 7) + 11}>
                    {c.title && c.title !== c.label ? <title>{c.title}</title> : null}
                    {c.label}
                  </text>
                </g>
              ))}
              {g.labels
                .filter((l) => l.kind === "dimension" || l.kind === "score")
                .map((l, i) => (
                  <text key={`d${i}`} className={l.kind === "dimension" ? "m2-rt m2-rdim" : "m2-rt m2-rsc"} x={l.x + l.width / 2} y={l.y + 11} textAnchor="middle" data-label={l.kind}>
                    <title>{l.title}</title>
                    {l.text}
                  </text>
                ))}
            </>
          ) : null}
          {g.tickY != null ? (
            <g className="m2-tick" data-measured={measured ?? undefined}>
              <rect className="m2-ks" x={tickLeft - 1} y={g.tickY - 1.75} width={tickWidth + 2} height={3.5} />
              <rect className="m2-k" x={tickLeft} y={g.tickY - 0.75} width={tickWidth} height={1.5} />
            </g>
          ) : null}
        </svg>
      </span>
      {showScore ? (
        <span className="m2-ruler-num">
          <span className="m2-sc" data-testid="ruler-score">{empty ? DASH : f1(score)}</span>
          {!empty && capped && measured != null ? <span className="m2-meas" data-testid="ruler-measured">{t("held down from {measured}", { measured: f1(measured) })}</span> : null}
          {!empty && props.contract ? <ContractMark mark={props.contract} /> : null}
          {!empty && props.policy ? <PolicyMark mark={props.policy} /> : null}
        </span>
      ) : !empty && (props.contract || props.policy) ? (
        <>
          {props.contract ? <ContractMark mark={props.contract} /> : null}
          {props.policy ? <PolicyMark mark={props.policy} /> : null}
        </>
      ) : null}
    </span>
  );
}
