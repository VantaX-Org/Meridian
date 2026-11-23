"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { refreshAdmin } from "@/lib/v2/admin-queries";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useCrumbs } from "@/ui/screens/flow";
import { useAdminBack } from "../common";
import { ErrorState, PageHeader, Skeleton, useAletheiaScope, useToast } from "@/ui/kit";

/** The least a query result must show for a section: loading, failed, and a retry. */
export interface Q { isLoading: boolean; isError: boolean; refetch: () => unknown }

export const day = (iso: string | null | undefined) => formatDate(iso, "date");
export const when = (iso: string | null | undefined) => formatDate(iso, "datetime");

/** Message of a failed write, shown in a toast. */
export const errText = (e: unknown): string => (e instanceof Error && e.message ? e.message : t("The change was not saved."));

/**
 * One admin section: the title always shows; the body waits for every read, shows a retry when one fails, and
 * hands the chat a one-line answer built from what is on screen.
 */
export function Sec({ title, context, actions, q = [], scope, facts = [], stepper, children }: {
  title: string; stepper?: ReactNode; context?: ReactNode; actions?: ReactNode; q?: Q[]; scope: string; facts?: string[]; children: ReactNode;
}) {
  useInterfaceLang();
  const back = useAdminBack();
  const crumbs = useCrumbs();
  useAletheiaScope({
    key: `admin/${scope}`,
    label: t("Asking about {screen}", { screen: title }),
    suggestions: [t("What needs attention here?")],
    answer: () => ({ text: facts.filter(Boolean).join(" ") || t("Nothing on this screen needs attention.") }),
  });
  const failed = q.find((x) => x.isError);
  return (
    <>
      <PageHeader crumbs={crumbs("admin", title)} back={back} title={title} context={context} actions={actions} stepper={stepper} />
      {failed ? <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => q.forEach((x) => x.refetch())} />
        : q.some((x) => x.isLoading) ? <Skeleton lines={8} label={t("Loading {screen}", { screen: title })} />
        : <Stack>{children}</Stack>}
    </>
  );
}

/** Runs a write, toasts the outcome and refreshes the admin reads it may have changed. */
export function useAct(...parts: string[]) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, done: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      toast(done, "good");
      await refreshAdmin(qc, ...parts);
      return r;
    } catch (e) {
      toast(errText(e), "bad");
      return undefined;
    } finally { setBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc, toast, parts.join("/")]);
  return { run, busy };
}

export function Stack({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gap: "var(--mx-s4)" }}>{children}</div>;
}
export function Row({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--mx-s3)", alignItems: "end" }}>{children}</div>;
}
