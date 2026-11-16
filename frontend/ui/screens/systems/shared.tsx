"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { relTime } from "@/lib/v2/format";
import type { SAPSystemExtended } from "@/types/api";
import { EmptyState, ErrorState, SeverityPill, Skeleton, type Severity } from "@/ui/kit";

export const healthLabel = (h: string | undefined | null): string =>
  h === "healthy" ? t("Healthy") : h === "degraded" ? t("Degraded") : h === "unreachable" ? t("Unreachable") : h === "auth_failed" ? t("Sign-in failed") : t("Not tested");

const healthSev = (h: string | undefined | null): Severity => (h === "healthy" ? "low" : h === "degraded" ? "medium" : h === "unreachable" || h === "auth_failed" ? "critical" : "info");

export const typeLabel = (s: string): string =>
  s === "ecc" ? t("SAP ECC") : s === "s4hana_onprem" ? t("SAP S/4HANA on premise") : s === "s4hana_cloud" ? t("SAP S/4HANA Cloud") : s === "successfactors" ? t("SAP SuccessFactors")
    : s === "concur" ? t("SAP Concur") : s === "ariba" ? t("SAP Ariba") : s === "btp" ? t("SAP BTP") : s === "ewm" ? t("SAP EWM") : s;

export const envLabel = (e: string): string => (e === "PRD" ? t("Production") : e === "QAS" ? t("Quality") : e === "DEV" ? t("Development") : e);

export const when = (iso: string | null | undefined): string => (iso ? relTime(iso) : t("Never"));

export const sysName = (s: Pick<SAPSystemExtended, "name" | "environment">): string => `${s.name} (${s.environment})`;

/** A dot and the word, so health never rests on colour alone. */
export function Health({ value }: { value: string | undefined | null }): ReactNode {
  return <SeverityPill sev={healthSev(value)} label={healthLabel(value)} />;
}

export const errMsg = (e: unknown): string => (e instanceof Error && e.message ? e.message : t("Something went wrong. Try again."));

/** Loading, error and empty handling shared by the tabs. */
export function Gate<T>({ q, empty, children }: { q: { isLoading: boolean; isError: boolean; data: T | undefined; refetch: () => unknown }; empty?: { heading: string; body?: string } | null; children: (d: T) => ReactNode }): ReactNode {
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading")} />;
  if (q.isError || q.data === undefined) return empty ? <EmptyState heading={empty.heading} body={empty.body} /> : <ErrorState heading={t("Could not load this")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  return children(q.data);
}
