import { mColor } from "../tokens";

/** DQS bands; the API's tenant thresholds (`/api/v1/objects` `thresholds`) override these defaults. */
export interface ScoreBands {
  target: number;
  warning: number;
  critical: number;
}
export const DEFAULT_SCORE_BANDS: ScoreBands = { target: 90, warning: 75, critical: 60 };

export function ScoreRing({ score, size = 48, bands = DEFAULT_SCORE_BANDS }: { score: number; size?: number; bands?: ScoreBands }) {
  const r = size / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = score >= bands.target ? mColor.pass : score >= bands.warning ? mColor.medium : mColor.critical;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Score ${score}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--m-line)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize={size / 3.2} fill="var(--m-ink)">
        {Math.round(score)}
      </text>
    </svg>
  );
}
