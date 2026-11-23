"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { usePermissionsContext } from "@/lib/permissions";
import { apiErrorMessage } from "@/lib/error";
import { t, tx, useInterfaceLang } from "@/lib/v2/i18n";
import { v2Locale } from "@/lib/v2/format";
import { refreshAdmin } from "@/lib/v2/admin-queries";
import { refreshStep9 } from "@/lib/v2/step9-queries";
import { getLlmConfig, getLlmProviders } from "@/lib/api/v2/llm";
import { ErrorState, Field, Input, PageHeader, Skeleton, useAletheiaScope, useToast } from "@/ui/kit";
import type { User } from "@/lib/api/v2/admin";

/** Whether the viewer holds any of these legacy actions. Fixture mode has no permissions provider and allows all. */
export function useCan(): (action: string) => boolean {
  const fx = useFixture();
  const ctx = usePermissionsContext();
  return (a) => (fx ? true : ctx?.can(a) ?? false);
}

export const canAny = (can: (a: string) => boolean, needs: readonly string[]): boolean => needs.some(can);

/** Short local date, or a dash when there is none. */
export function day(iso: string | null | undefined): string {
  if (!iso) return t("Never");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? t("Never") : d.toLocaleDateString(v2Locale(), { year: "numeric", month: "short", day: "numeric" });
}

/** The last active administrator may not be removed or suspended, and nobody removes themselves. */
export const isAdminRole = (u: Pick<User, "role">): boolean => u.role === "admin" || u.role === "platform_admin";
export function isLastAdmin(user: User, all: User[]): boolean {
  return isAdminRole(user) && user.is_active && !all.some((o) => o.id !== user.id && o.is_active && isAdminRole(o));
}
export function removeBlock(user: User, all: User[], selfId: string | null): "self" | "last-admin" | null {
  if (selfId && user.id === selfId) return "self";
  return isLastAdmin(user, all) ? "last-admin" : null;
}

/** LLM settings have no shared hook; this is the one read both the page and its chat use. */
export function useLlm() {
  const fx = useFixture();
  const config = useQuery({ queryKey: ["v2", "admin", fx, "llm-config"], queryFn: getLlmConfig, staleTime: 15_000, retry: false });
  const providers = useQuery({ queryKey: ["v2", "admin", fx, "llm-providers"], queryFn: getLlmProviders, staleTime: 15_000, retry: false });
  return { config, providers };
}

/** Scope the one shell chat to this admin section; answers are drawn from the facts the screen already shows. */
export function useSectionChat(key: string, label: string, facts: string[], prompts: string[]) {
  useAletheiaScope({
    key: `admin/${key}`,
    label: t("Asking about {section}", { section: label }),
    suggestions: prompts,
    answer: () => ({
      text: facts.length ? facts[0] : t("There is nothing to report here yet."),
      evidence: facts.slice(1, 6),
    }),
  });
}

/** Runs a write: toast the result, refresh the named admin reads. */
export function useAct() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, done: string, refresh: string[] = []): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      toast(done, "good");
      for (const k of refresh) { if (k === "webhooks") refreshStep9(qc as QueryClient, "webhooks"); else refreshAdmin(qc as QueryClient, k); }
      return r;
    } catch (e) {
      toast(tx(apiErrorMessage(e)), "bad");
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** The one back link every admin sub-page shows, to the administration index. */
export const useAdminBack = () => { const fx = useFixture(); return { href: withFixture("/admin", fx), label: t("Back to Administration") }; };

/** The page frame every section uses: title, one-line lead, loading and error states. */
export function Frame({ slug, title, lead, actions, loading, error, children }: {
  slug: string; title: string; lead: string; actions?: ReactNode; loading?: boolean; error?: boolean; children: ReactNode;
}) {
  useInterfaceLang();
  const qc = useQueryClient();
  const back = useAdminBack();
  return (
    <div className="mx-col" data-admin={slug}>
      <PageHeader back={back} title={title} context={lead} actions={actions} />
      {loading ? <Skeleton lines={6} label={t("Loading {section}", { section: title })} />
        : error ? <ErrorState heading={t("{section} could not be loaded", { section: title })} retryLabel={t("Try again")} onRetry={() => void qc.invalidateQueries({ queryKey: ["v2", "admin"] })} />
        : children}
    </div>
  );
}

/** A plain label and value list. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="mx-col">
      {items.map(([k, v]) => (
        <div key={k} className="mx-links">
          <dt className="mx-muted">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A labelled number input that edits a plain number. */
export function Num({ label, hint, value, onChange, step = 1, min = 0, max }: {
  label: string; hint?: string; value: number | null; onChange: (v: number) => void; step?: number; min?: number; max?: number;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input type="number" step={step} min={min} max={max} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}

/** Copy a loaded value into local form state once per change, during render (no effect). */
export function useSync<T>(src: T | null | undefined, apply: (s: T) => void) {
  const [prev, setPrev] = useState<T | null | undefined>(undefined);
  if (src !== prev) {
    setPrev(src);
    if (src != null) apply(src);
  }
}
