/** The DQS ring. The one place a score is drawn as a shape; size 120 sits beside a Tally, 200 leads a page. */
export interface ScoreRingProps {
  score: number;
  size?: 200 | 120;
  /** Why the score is capped. Part of the accessible name whenever it is set. */
  capReason?: string | null;
}

const band = (n: number) => (n < 70 ? "fail" : n < 85 ? "warn" : "pass");

export function ScoreRing({ score, size = 200, capReason }: ScoreRingProps) {
  const r = 84;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ui-ring" data-size={size} data-band={band(score)} viewBox="0 0 200 200" role="img"
         aria-label={`Data quality score ${score.toFixed(1)} out of 100${capReason ? `, capped: ${capReason}` : ""}`}>
      <circle cx="100" cy="100" r={r} className="ui-ring__track" />
      <circle cx="100" cy="100" r={r} className="ui-ring__fill"
              strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 100 100)" />
      <text x="100" y="104" className="ui-ring__num">{score.toFixed(1)}</text>
      <text x="100" y="134" className="ui-ring__unit">of 100</text>
    </svg>
  );
}
