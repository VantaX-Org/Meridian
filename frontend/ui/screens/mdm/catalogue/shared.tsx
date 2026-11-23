"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { useCrumbs, type Place } from "@/ui/screens/flow";
import { Button, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton, useAletheia, useAletheiaScope, type AletheiaAnswer, type Severity, SeverityPill } from "@/ui/kit";

/** One typed read, keyed by the fixture flag so fixture and live answers never mix. */
export function useRead<T>(key: readonly unknown[], fn: () => Promise<T>, enabled = true) {
  const fx = useFixture();
  return useQuery({ queryKey: ["b7b", fx, ...key], queryFn: fn, enabled, staleTime: 30_000 });
}

/** Skeleton while loading, an error state when the read fails, otherwise the body. */
export function Async<T>({ q, lines = 6, children }: { q: { isLoading: boolean; isError: boolean; data: T | undefined; refetch: () => unknown }; lines?: number; children: (d: T) => ReactNode }) {
  if (q.isLoading) return <Skeleton lines={lines} label={t("Loading")} />;
  if (q.isError || q.data === undefined) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return <>{children(q.data)}</>;
}

export function Empty({ heading, body }: { heading: string; body?: string }) {
  return <EmptyState heading={heading} body={body} />;
}

/** The connected systems and the one in use. `sf` picks SuccessFactors systems, otherwise SAP ones. */
export function useSystemPick(sf = false) {
  const q = useRead(["systems"], getSystemsExtended);
  const list = (q.data ?? []).filter((s) => (s.system_type === "successfactors") === sf);
  const [pick, setPick] = useState<string>("");
  const id = list.some((s) => s.id === pick) ? pick : list[0]?.id ?? "";
  const control = (
    <Field label={t("System")}>
      <Select value={id} onChange={(e) => setPick(e.target.value)} options={list.length ? list.map((s) => ({ value: s.id, label: s.name })) : [{ value: "", label: t("No system connected") }]} />
    </Field>
  );
  return { id, list, control, loading: q.isLoading };
}

/** Scopes the one shell chat to this screen. The answer comes from what the screen already loaded. */
export function useScreenScope(key: string, label: string, prompts: { prompt: string; answer: () => AletheiaAnswer }[]) {
  useAletheiaScope({
    key, label, suggestions: prompts.map((p) => p.prompt),
    answer: (q) => (prompts.find((p) => p.prompt === q) ?? prompts[0]).answer(),
  });
}

export function AskButton() {
  const chat = useAletheia();
  return <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>;
}

export function Head({ title, context, actions, place = "mdm", stepper }: { title: string; context?: ReactNode; actions?: ReactNode; place?: Place; stepper?: ReactNode }) {
  const crumbs = useCrumbs();
  return <PageHeader crumbs={crumbs(place, title)} stepper={stepper} title={title} context={context} actions={<>{actions}<AskButton /></>} />;
}

export const when = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : t("n/a"));
export const num = (n: number | null | undefined): string => (n === null || n === undefined ? t("n/a") : new Intl.NumberFormat("en").format(n));
export const sevText = (s: string): string => (s === "critical" ? t("Critical") : s === "high" ? t("High") : s === "medium" ? t("Medium") : s === "low" ? t("Low") : t("Info"));
export function Sev({ s }: { s: string }) {
  return <SeverityPill sev={s as Severity} label={sevText(s)} />;
}
