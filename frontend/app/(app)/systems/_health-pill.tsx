// A connection's health in its own vocabulary (Healthy, Degraded, Unreachable, Sign-in refused), never the data's
// readiness verdict ("No-go" is about whether data can go live, not whether a system answers). The pill borrows the
// verdict's status tone only; the words are the connection's.
import { Pill } from "@/design";
import type { HealthStatus } from "@/types/api";
import { HEALTH_LABEL, HEALTH_VERDICT, healthReason } from "./_health";

export function HealthPill({ status }: { status: HealthStatus | null | undefined }) {
  const s = status ?? "unknown";
  const tone = HEALTH_VERDICT[s];
  return tone ? <Pill tone={tone}>{HEALTH_LABEL[s]}</Pill> : <span className="m-ink-3">{HEALTH_LABEL.unknown}</span>;
}

/** The stored reason as a plain sentence; the raw code or error text is the tooltip. */
export function HealthReason({ message, className }: { message: string | null | undefined; className?: string }) {
  const r = healthReason(message);
  if (!r) return null;
  return <span className={className} title={r.raw !== r.text ? r.raw : undefined}>{r.text}</span>;
}
