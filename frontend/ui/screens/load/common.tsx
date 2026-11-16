"use client";

import type { ReactNode } from "react";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, ErrorState, Skeleton, useAletheia } from "@/ui/kit";

/** "material_master" reads "Material master" when no label is known. */
export const humanize = (m: string): string => { const s = m.replace(/[_-]+/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 10) / 10}%`);
export const when = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");
export const useHref = () => { const fx = useFixture(); return (p: string) => withFixture(p, fx); };

export const verdictLabel = (v: string | null | undefined): string =>
  v === "go" || v === "passing" ? t("Go") : v === "conditional" || v === "at_risk" ? t("At risk") : v === "no-go" || v === "no_go" ? t("No-go") : v === "not_run" ? t("Not run") : t("Not assessed");

/** A word with a coloured dot. `tone` maps to the kit severity colours. */
export function Verdict({ v }: { v: string | null | undefined }) {
  const sev = v === "go" || v === "passing" ? "low" : v === "conditional" || v === "at_risk" ? "medium" : v === "no-go" || v === "no_go" ? "critical" : "info";
  return <span className="mx-sev" data-sev={sev}><i className="mx-dot" aria-hidden="true" />{verdictLabel(v)}</span>;
}

export function Gate({ loading, error, children, what }: { loading: boolean; error: boolean; children: ReactNode; what: string }) {
  if (loading) return <Skeleton lines={8} label={t("Loading {what}", { what })} />;
  if (error) return <ErrorState heading={t("{what} could not be loaded", { what })} />;
  return <>{children}</>;
}

export function AskButton() {
  const chat = useAletheia();
  return <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>;
}

/** A dated list of events, newest last. */
export function Timeline({ events, label }: { events: { id: string; at: string; title: ReactNode; note?: ReactNode }[]; label: string }) {
  return (
    <ol aria-label={label}>
      {events.map((e) => (
        <li key={e.id}><time className="mx-muted mx-num">{when(e.at)}</time><span>{e.title}</span>{e.note ? <span className="mx-muted">{e.note}</span> : null}</li>
      ))}
    </ol>
  );
}
