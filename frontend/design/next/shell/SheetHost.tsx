"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { Sheet } from "../kit/Sheet";
import { AskBody } from "@/design/v2/inspector/ask";
import { LegacyScope } from "./LegacyMount";
import { NextPalette } from "../CommandPalette";
import { popSheet, pushSheet, sheetsOf, stepOf, withSheets, type SheetRef } from "@/lib/next/sheet";
import { registry, registerSheet } from "./registry";
import "./sheets";

export interface SheetCtx {
  id: string;
  step: number;
  setStep: (n: number) => void;
  close: () => void;
  dismiss: () => void;
  open: (ref: SheetRef) => void;
  /** True for the lower sheet of a stack. */
  under: boolean;
}
export type SheetRenderer = (ctx: SheetCtx) => ReactNode;

export { registerSheet };

/** How many sheets this page session pushed, so Back can be used to close and the history stays clean. */
let pushed = 0;

export interface SheetsApi {
  stack: SheetRef[];
  step: number;
  open: (ref: SheetRef) => void;
  close: () => void;
  /** Drops the top sheet in place (no history step back): for a sheet that hands over to a page or another sheet. */
  dismiss: () => void;
  setStep: (n: number) => void;
}
const Ctx = createContext<SheetsApi | null>(null);

function useApi(): SheetsApi {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const stack = useMemo(() => sheetsOf(sp), [sp]);
  const step = stepOf(sp);
  const to = useCallback((s: SheetRef[], n = 1) => {
    const q = withSheets(sp, s, n);
    return q ? `${path}?${q}` : path;
  }, [sp, path]);
  const open = useCallback((ref: SheetRef) => {
    pushed += 1;
    router.push(to(pushSheet(stack, ref)), { scroll: false });
  }, [router, to, stack]);
  const close = useCallback(() => {
    if (!stack.length) return;
    if (pushed > 0) {
      pushed -= 1;
      router.back();
    } else router.replace(to(popSheet(stack)), { scroll: false });
  }, [router, to, stack]);
  const dismiss = useCallback(() => {
    if (pushed > 0) pushed -= 1;
    router.replace(to(popSheet(stack)), { scroll: false });
  }, [router, to, stack]);
  const setStep = useCallback((n: number) => router.replace(to(stack, n), { scroll: false }), [router, to, stack]);
  return useMemo(() => ({ stack, step, open, close, dismiss, setStep }), [stack, step, open, close, dismiss, setStep]);
}

export function useSheets(): SheetsApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSheets needs a SheetHost"); // i18n-ignore;
  return c;
}

registerSheet("command", ({ dismiss }) => <NextPalette open onClose={dismiss} />);
registerSheet("ask", ({ close, under }) => (
  <Sheet open onClose={close} title={t("Ask Meridian")} size="small" under={under}>
    <LegacyScope><AskBody hero /></LegacyScope>
  </Sheet>
));

/** Provides `useSheets` and renders the stack named by `?sheet=`. */
export function SheetHost({ children }: { children: ReactNode }) {
  const api = useApi();
  return (
    <Ctx.Provider value={api}>
      {children}
      {api.stack.map((ref, i) => {
        const render = registry.get(ref.kind);
        if (!render) return null;
        const top = i === api.stack.length - 1;
        return (
          <div key={`${i}-${ref.kind}:${ref.id}`}>
            {render({ id: ref.id, step: top ? api.step : 1, setStep: api.setStep, close: api.close, dismiss: api.dismiss, open: api.open, under: !top })}
          </div>
        );
      })}
    </Ctx.Provider>
  );
}
