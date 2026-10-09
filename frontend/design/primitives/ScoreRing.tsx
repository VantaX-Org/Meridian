import { mColor } from "../tokens";

export function ScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const r = size / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const color = score >= 85 ? mColor.pass : score >= 60 ? mColor.medium : mColor.critical;
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
