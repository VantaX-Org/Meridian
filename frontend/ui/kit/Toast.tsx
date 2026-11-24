"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";

export type ToastTone = "info" | "good" | "bad";
export interface ToastOptions {
  /** One button on the toast. With `undo` set, Ctrl or Cmd Z while the toast is open fires it too. */
  action?: { label: string; onAction: () => void; undo?: boolean };
  /** 0 to 1: a progress line under the message (a long job). */
  progress?: number;
  /** Overrides the host's default time on screen. */
  ms?: number;
}
interface Item extends ToastOptions { id: number; message: string; tone: ToastTone }
type Push = (message: string, tone?: ToastTone, options?: ToastOptions) => void;
const Ctx = createContext<Push>(() => undefined);

/** Short messages in a polite live region; each clears itself after `ms`. A toast can carry one action and a progress line. */
export function ToastHost({ children, ms = 4000 }: { children: ReactNode; ms?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const n = useRef(0);
  const drop = useCallback((id: number) => setItems((x) => x.filter((i) => i.id !== id)), []);
  const push = useCallback<Push>((message, tone = "info", options = {}) => {
    const id = ++n.current;
    setItems((x) => [...x, { id, message, tone, ...options }]);
    setTimeout(() => drop(id), options.ms ?? ms);
  }, [ms, drop]);
  const undoable = [...items].reverse().find((i) => i.action?.undo);
  useEffect(() => {
    if (!undoable) return;
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const el = e.target as HTMLElement | null;
        if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
        e.preventDefault();
        undoable.action?.onAction();
        drop(undoable.id);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [undoable, drop]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="mx-toasts" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className="mx-toast" data-tone={i.tone}>
            <p>{i.message}</p>
            {i.action && <Button variant="ghost" onClick={() => { i.action?.onAction(); drop(i.id); }}>{i.action.label}</Button>}
            {i.progress !== undefined && <progress className="mx-toast-progress" max={1} value={i.progress} aria-label={i.message} />}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
