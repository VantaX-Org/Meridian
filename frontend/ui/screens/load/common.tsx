"use client";

import type { ReactNode } from "react";
import { withFixture, useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, ErrorState, SeverityPill, Skeleton, useAletheia } from "@/ui/kit";

/** "fi_gl" reads "FI general ledger": machine ids go through the shared labels; text that is already a label stays as it is. */
export const humanize = (m: string): string => (/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(m) ? labelText(m) : m);
export const pct = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : `${Math.round(n * 10) / 10}%`);
export const when = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : "");
export const useHref = () => { const fx = useFixture(); return (p: string) => withFixture(p, fx); };

export const verdictLabel = (v: string | null | undefined): string =>
  v === "go" || v === "passing" ? t("Go") : v === "conditional" || v === "at_risk" ? t("At risk") : v === "no-go" || v === "no_go" ? t("No-go") : v === "not_run" ? t("Not run") : t("Not assessed");

/** A word with a coloured dot. `tone` maps to the kit severity colours. */
export function Verdict({ v }: { v: string | null | undefined }) {
  const sev = v === "go" || v === "passing" ? "good" : v === "conditional" || v === "at_risk" ? "medium" : v === "no-go" || v === "no_go" ? "critical" : "info";
  return <SeverityPill sev={sev} label={verdictLabel(v)} />;
}

export function Gate({ loading, error, retry, children, what }: { loading: boolean; error: boolean; retry?: () => void; children: ReactNode; what: string }) {
  if (loading) return <Skeleton lines={8} label={t("Loading {what}", { what })} />;
  if (error) return <ErrorState heading={t("{what} could not be loaded", { what })} retryLabel={t("Try again")} onRetry={retry} />;
  return <>{children}</>;
}

export function AskButton() {
  const chat = useAletheia();
  return <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>;
}
