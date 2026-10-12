import type { Severity } from "../tokens";
import { severityColor, severityShape } from "../tokens";

export function SeverityDot({ severity }: { severity: Severity }) {
  const color = severityColor[severity];
  const shape = severityShape[severity];
  const common = { width: 10, height: 10, display: "inline-block" } as const;
  if (shape === "square") return <span style={{ ...common, background: color }} aria-label={severity} role="img" />;
  if (shape === "circle") return <span style={{ ...common, background: color, borderRadius: "50%" }} aria-label={severity} role="img" />;
  if (shape === "ring") return <span style={{ ...common, border: `2px solid ${color}`, borderRadius: "50%" }} aria-label={severity} role="img" />;
  if (shape === "check") {
    return (
      <svg width={8} height={8} viewBox="0 0 8 8" aria-label={severity} role="img" style={{ display: "inline-block" }}>
        <path d="M1 4.2 3.2 6.4 7 1.6" fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // triangle
  return (
    <span
      aria-label={severity}
      role="img"
      style={{
        display: "inline-block",
        width: 0,
        height: 0,
        borderLeft: "5px solid transparent",
        borderRight: "5px solid transparent",
        borderBottom: `9px solid ${color}`,
      }}
    />
  );
}
