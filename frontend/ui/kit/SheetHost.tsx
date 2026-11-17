"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/v2/i18n";
import { useAletheiaIfAny } from "./aletheia";
import { openRoute } from "./openRedirect";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

export interface SheetDef { label: string; render: (arg: unknown) => ReactNode }
interface Api { open: (id: string, arg?: unknown) => void; close: () => void; current: string | null }
const Ctx = createContext<Api>({ open: () => undefined, close: () => undefined, current: null });

/** Holds one open sheet at a time. Register sheets by id; any screen opens one with useSheet().open(id, arg). */
export function SheetHost({ sheets, closeLabel, children }: { sheets: Record<string, SheetDef>; closeLabel: string; children: ReactNode }) {
  const [cur, setCur] = useState<{ id: string; arg: unknown } | null>(null);
  const open = useCallback((id: string, arg?: unknown) => setCur({ id, arg }), []);
  const close = useCallback(() => setCur(null), []);
  const router = useRouter();
  const toast = useToast();
  const chat = useAletheiaIfAny();
  const api = useMemo(() => ({ open, close, current: cur?.id ?? null }), [open, close, cur]);
  // Deep link: ?open=kind:id opens that sheet once on arrival. Kinds with no sheet go to the page that shows them, or say there is none.
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("open");
    const i = v ? v.indexOf(":") : -1;
    const kind = v ? (i < 0 ? v : v.slice(0, i)) : "";
    if (!v || !kind) return;
    const id = i < 0 ? undefined : v.slice(i + 1);
    if (!sheets[kind]) {
      const q = new URLSearchParams(window.location.search);
      q.delete("open");
      if (kind === "ask") chat?.setOpen(true);
      else {
        const to = openRoute(kind, id);
        if (!to) toast(t("This link points to {kind}, which has no page yet.", { kind }), "bad");
        else {
          // Keep fixture, role and the like; the target's own query wins.
          const [path, own = ""] = to.split("?");
          new URLSearchParams(own).forEach((val, key) => q.set(key, val));
          router.replace(q.size ? `${path}?${q}` : path);
          return;
        }
      }
      router.replace(q.size ? `${window.location.pathname}?${q}` : window.location.pathname);
      return;
    }
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
