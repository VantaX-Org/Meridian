"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { Sheet, closingSheet } from "../kit/Sheet";
import { AskBody } from "@/design/v2/inspector/ask";
import { LegacyScope } from "./LegacyMount";
import { NextPalette } from "../CommandPalette";
import { Button } from "../kit/Button";
import { ConnectCanvas } from "@/design/v2/screens/system/ConnectCanvas";
import { popSheet, pushSheet, sheetsOf, stepOf, withSheets, type SheetRef } from "@/lib/next/sheet";
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

const registry = new Map<string, SheetRenderer>();
/** Adds a sheet kind. The renderer returns a kit `Sheet` (open is the renderer's to set to true). */
export function registerSheet(kind: string, render: SheetRenderer): void {
  registry.set(kind, render);
}

/**
 * A history entry this host pushed for a sheet carries `nxSheet`, so Close steps back to the page under it and
 * browser Back closes the sheet. Only custom keys are passed: Next copies its own state into the entry.
 */
const pushedHere = (): boolean => typeof window !== "undefined" && !!(window.history.state as { nxSheet?: boolean } | null)?.nxSheet;
const pushUrl = (url: string) => window.history.pushState({ nxSheet: true }, "", url);
const replaceUrl = (url: string) => window.history.replaceState(pushedHere() ? { nxSheet: true } : {}, "", url);

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
  const path = usePathname();
  const sp = useSearchParams();
  const stack = useMemo(() => sheetsOf(sp), [sp]);
  const step = stepOf(sp);
  const to = useCallback((s: SheetRef[], n = 1) => {
    const q = withSheets(sp, s, n);
    return q ? `${path}?${q}` : path;
  }, [sp, path]);
  const open = useCallback((ref: SheetRef) => pushUrl(to(pushSheet(stack, ref))), [to, stack]);
  const close = useCallback(() => {
    if (!stack.length) return;
    if (pushedHere()) {
      closingSheet();
      window.history.back();
    }
    else replaceUrl(to(popSheet(stack)));
  }, [to, stack]);
  const dismiss = useCallback(() => replaceUrl(to(popSheet(stack))), [to, stack]);
  const setStep = useCallback((n: number) => replaceUrl(to(stack, n)), [to, stack]);
  // A sheet reached by a link or a refresh has no page entry under it: put one there, so Back closes the sheet.
  const deep = stack.length > 0 && stack.every((r) => registry.has(r.kind)) && !pushedHere();
  useEffect(() => {
    if (!deep) return;
    const here = to(stack, step);
    window.history.replaceState({}, "", to([]));
    pushUrl(here);
  }, [deep, to, stack, step]);
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

registerSheet("connect", ({ close, under }) => (
  <Sheet open onClose={close} title={t("Connect a system")} size="large" under={under}>
    <LegacyScope><ConnectCanvas /></LegacyScope>
  </Sheet>
));

/** What an address naming no registered sheet shows: one sentence and the way home. The bad name is already gone from the address. */
function LostSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  return (
    <Sheet open onClose={onClose} title={t("This panel was not found")} size="small"
      primary={<Button variant="primary" onClick={() => { onClose(); router.push("/"); }}>{t("Go to Home")}</Button>}>
      <p>{t("The link names a panel that does not exist or has moved.")}</p>
    </Sheet>
  );
}

/** Provides `useSheets` and renders the stack named by `?sheet=`. */
export function SheetHost({ children }: { children: ReactNode }) {
  const api = useApi();
  const path = usePathname();
  const sp = useSearchParams();
  const [lost, setLost] = useState(false);
  const bad = api.stack.some((ref) => !registry.has(ref.kind));
  // State set during render, not in the effect: React re-renders at once without a cascade.
  if (bad && !lost) setLost(true);
  // Drop the unknown names from the address and say so in a sheet of its own.
  useEffect(() => {
    if (!bad) return;
    const keep = api.stack.filter((ref) => registry.has(ref.kind));
    const q = withSheets(sp, keep, api.step);
    window.history.replaceState({}, "", q ? `${path}?${q}` : path);
  }, [bad, api.stack, api.step, sp, path]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {lost ? <LostSheet onClose={() => setLost(false)} /> : null}
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
