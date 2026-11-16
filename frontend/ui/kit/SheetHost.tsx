"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
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
  const def = cur ? sheets[cur.id] : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      <Sheet open={!!def} onClose={close} label={def?.label ?? ""} closeLabel={closeLabel}>{def && cur ? def.render(cur.arg) : null}</Sheet>
    </Ctx.Provider>
  );
}

export const useSheet = () => useContext(Ctx);
