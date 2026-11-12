"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getCatalogueTable, getCatalogueTables, searchCatalogueFields, type CatalogueField } from "@/lib/api/v2/catalogue";
import { systemTypeText } from "./labels";
import { t } from "./i18n";

/** Query keys of the data catalogue. The fixture flag is part of every key, so a demo never shows a live answer. */
export const catalogueKeys = {
  tables: (f: boolean, q: string, system: string) => ["v2", "catalogue", "tables", f, q, system] as const,
  table: (f: boolean, table: string, system: string) => ["v2", "catalogue", "table", f, table, system] as const,
  fields: (f: boolean, q: string, system: string) => ["v2", "catalogue", "fields", f, q, system] as const,
};

const STALE = 5 * 60_000;
const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
/** A refusal (403) or an unknown table or system (404) is an answer; only other failures are retried. */
export const catalogueRetry = (n: number, e: unknown): boolean => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
export const catalogueStatus = status;

export function useCatalogueTables(q: string, system: string) {
  const f = useFixture();
  return useQuery({ queryKey: catalogueKeys.tables(f, q, system), queryFn: () => getCatalogueTables({ q, system }), staleTime: STALE, placeholderData: keepPreviousData, retry: catalogueRetry });
}

export function useCatalogueTable(table: string, system: string, enabled = true) {
  const f = useFixture();
  return useQuery({ queryKey: catalogueKeys.table(f, table, system), queryFn: () => getCatalogueTable(table, system || undefined), staleTime: STALE, enabled: enabled && table !== "", retry: catalogueRetry });
}

export function useCatalogueFields(q: string, system: string) {
  const f = useFixture();
  return useQuery({ queryKey: catalogueKeys.fields(f, q, system), queryFn: () => searchCatalogueFields(q, system || undefined), staleTime: STALE, enabled: q.trim().length >= 2, placeholderData: keepPreviousData, retry: catalogueRetry });
}

/** Where a table's or a field's definition comes from, in words. */
export function sourceText(source: string): string {
  if (source === "live") return t("The system's own dictionary");
  if (source === "sap_standard+s4_delta") return t("SAP standard, with the S/4HANA changes");
  if (source.startsWith("canonical:")) return t("{system} view", { system: systemTypeText(source.slice("canonical:".length)) });
  return t("SAP standard");
}

/** "CHAR 18", "DEC 13,3", or the type alone when it has no fixed length. */
export function typeText(f: Pick<CatalogueField, "type" | "length" | "decimals">): string {
  if (!f.type) return "";
  if (!f.length) return f.type;
  return f.decimals ? `${f.type} ${f.length},${f.decimals}` : `${f.type} ${f.length}`;
}

/** The lineage node types the catalogue names, in words. */
export function nodeTypeText(type: string): string {
  if (type === "object") return t("Business object");
  if (type === "step") return t("Process step");
  if (type === "process") return t("Process");
  if (type === "feature") return t("S/4 feature");
  if (type === "kpi") return t("KPI");
  return type;
}
