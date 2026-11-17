"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Sheet } from "./Sheet";

export interface SheetDef { label: string; render: (arg: unknown) => ReactNode }
interface Api { open: (id: string, arg?: unknown) => void; close: () => void; current: string | null }
const Ctx = createContext<Api>({ open: () => undefined, close: () => undefined, current: null });

/** Holds one open sheet at a time. Register sheets by id; any screen opens one with useSheet().open(id, arg). */
export function SheetHost({ sheets, closeLabel, children }: { sheets: Record<string, SheetDef>; closeLabel: string; children: ReactNode }) {
  const [cur, setCur] = useState<{ id: string; arg: unknown } | null>(null);
  const open = useCallback((id: string, arg?: unknown) => setCur({ id, arg }), []);
  const close = useCallback(() => setCur(null), []);
  const api = useMemo(() => ({ open, close, current: cur?.id ?? null }), [open, close, cur]);
  // Deep link: ?open=kind:id opens that sheet once on arrival. Kinds with no sheet are ignored.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("open");
    const i = v ? v.indexOf(":") : -1;
    const kind = v ? (i < 0 ? v : v.slice(0, i)) : "";
    if (!v || !kind || !sheets[kind]) return;
    const id = i < 0 ? undefined : v.slice(i + 1);
    // Rule sheets take { id }; the rest take the bare id.
    setCur({ id: kind, arg: kind === "rule" || kind === "library-rule" ? { id } : id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const def = cur ? sheets[cur.id] : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={!!def} onClose={close} label={def?.label ?? ""} closeLabel={closeLabel}>{def && cur ? def.render(cur.arg) : null}</Sheet>
    </Ctx.Provider>
  );
}

export const useSheet = () => useContext(Ctx);
