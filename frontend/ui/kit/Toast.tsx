"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

export type ToastTone = "info" | "good" | "bad";
interface Item { id: number; message: string; tone: ToastTone }
const Ctx = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

/** Short messages in a polite live region; each clears itself after `ms`. */
export function ToastHost({ children, ms = 4000 }: { children: ReactNode; ms?: number }) {
  const [items, setItems] = useState<Item[]>([]);
  const n = useRef(0);
  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++n.current;
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), ms);
  }, [ms]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="mx-toasts" role="status" aria-live="polite">
        {items.map((i) => <p key={i.id} className="mx-toast" data-tone={i.tone}>{i.message}</p>)}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
