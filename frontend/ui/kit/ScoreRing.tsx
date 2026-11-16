const R = 52;
const C = 2 * Math.PI * R;
const tone = (v: number) => (v >= 90 ? "var(--mx-good)" : v >= 70 ? "var(--mx-warn)" : "var(--mx-bad)");

/** The score as a ring with the number inside. `value` null draws an empty ring with `naLabel`. */
export function ScoreRing({ value, label, naLabel, size = 120 }: { value: number | null; label: string; naLabel: string; size?: number }) {
  const v = value === null ? 0 : Math.max(0, Math.min(100, value));
  return (
    <svg role="img" aria-label={`${label}: ${value === null ? naLabel : Math.round(v * 10) / 10}`} viewBox="0 0 120 120" width={size} height={size} className="mx-ring">
      <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" style={{ stroke: "var(--mx-surface-2)" }} />
      {value === null ? null : (
        <circle cx="60" cy="60" r={R} fill="none" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(C * v) / 100} ${C}`} transform="rotate(-90 60 60)" style={{ stroke: tone(v) }} />
      )}
      <text x="60" y="68" textAnchor="middle" className="mx-ring-n">{value === null ? naLabel : Math.round(v)}</text>
    </svg>
  );
}
