"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { Icon } from "../Icon";

export interface ToastInput {
  text: string;
  tone?: "neutral" | "good" | "bad";
  /** Shows an Undo button; the handler reverses the action. */
  onUndo?: () => void;
  /** Milliseconds before it leaves. 0 keeps it until dismissed. Default 6000. */
  timeout?: number;
}
interface Item extends ToastInput {
  id: number;
}

const Ctx = createContext<{ push: (t: ToastInput) => void } | null>(null);
const MAX = 3;

/** One live region for every toast, a stack of three (oldest leaves first). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const drop = useCallback((id: number) => setItems((l) => l.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (input: ToastInput) => {
      const id = ++seq.current;
      setItems((l) => [...l, { ...input, id }].slice(-MAX));
      const ms = input.timeout ?? 6000;
      if (ms > 0) setTimeout(() => drop(id), ms);
    },
    [drop],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="nx-toasts" role="status" aria-live="polite" aria-atomic="false">
        {items.map((it) => (
          <div key={it.id} className="nx-toast nx-toast-item" data-tone={it.tone ?? "neutral"}>
            <Icon name={it.tone === "good" ? "check" : it.tone === "bad" ? "alert" : "info"} />
            <span className="nx-toast-text">{it.text}</span>
            {it.onUndo ? (
              <Button
                variant="quiet"
                size={32}
                icon="undo"
                onClick={() => {
                  it.onUndo?.();
                  drop(it.id);
                }}
              >
                {t("Undo")}
              </Button>
            ) : null}
            <button type="button" className="nx-icon-btn" aria-label={t("Dismiss")} onClick={() => drop(it.id)}>
              <Icon name="x" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): (t: ToastInput) => void {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast needs a ToastProvider"); // i18n-ignore
  return c.push;
}
