"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { mdmKeys } from "@/lib/v2/mdm-queries";
import { Field, Select, useToast } from "@/ui/kit";

export const DEFAULT_DOMAIN = "material_master";

/** The objects the master data screens cover. Names are the module ids the backend uses. */
export const domainOptions = () => [
  { value: "material_master", label: t("Material master") },
  { value: "sd_customer_master", label: t("Customer master") },
];

export const domainLabel = (d: string): string => domainOptions().find((o) => o.value === d)?.label ?? d;

export function DomainSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label={t("Object")}>
      <Select options={domainOptions()} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** A path that keeps the fixture flag when it is on. */
export function useHref(): (path: string) => string {
  const fx = useFixture();
  return useCallback((path: string) => withFixture(path, fx), [fx]);
}

export const pct = (n: number | null | undefined, fraction = true): string =>
  n === null || n === undefined ? t("n/a") : `${Math.round(fraction ? n * 100 : n)}%`;

export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : t("n/a"));

export const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Runs a write, reports the outcome in a toast and refreshes every master data read. */
export function useAct() {
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const act = useCallback(async <T,>(fn: () => Promise<T>, ok: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      toast(typeof ok === "function" ? ok(r) : ok, "good");
      await qc.invalidateQueries({ queryKey: mdmKeys.root });
      return r;
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t("The change could not be saved"), "bad");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast, qc]);
  return { act, busy };
}

export const statusLabel = (s: string): string =>
  s === "golden" ? t("Golden") : s === "candidate" ? t("Candidate") : s === "pending_review" ? t("Pending review") : s === "superseded" ? t("Superseded") : s;

/** A master data key with its plain description beside it (for materials: the name). */
export const keyText = (key: string): string => key.replace(/^[A-Z]+=/, "").replace(/^0+(?=\d)/, "");
