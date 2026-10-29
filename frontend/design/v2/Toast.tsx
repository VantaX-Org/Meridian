"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorSentence, postUndo } from "@/lib/api/v2/work";
import { refreshV2 } from "@/lib/v2/queries";
import { peekAction, popAction, pushAction, removeAction, type DoneAction } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { IconClose } from "./marks";

/** How long a notice stays: a change can be taken back from it for this long. */
export const TOAST_MS = 6000;

interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: DoneAction;
}

export interface ToastApi {
  /** A plain notice (paste filled 3 rows, a file was read) or an error sentence. */
  show(message: string, tone?: "info" | "error"): void;
  /** A change that was made: "Accepted 112 suggested values" with Undo. Remembered for Cmd+Z. */
  done(action: DoneAction): void;
  /** Takes the last change back. Says so when there is nothing to take back. */
  undoLast(): Promise<void>;
}

const NOOP: ToastApi = { show: () => undefined, done: () => undefined, undoLast: async () => undefined };
const Ctx = createContext<ToastApi>(NOOP);

export const useToast = (): ToastApi => useContext(Ctx);

/**
 * The notices: one live region at the bottom of the screen, announced politely (an error as an alert). Every change
 * made on the ledger posts one with Undo for six seconds. Cmd+Z takes the last change back while it is still inside
 * the server's ten minutes; a refusal (409) shows the server's own sentence.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((cur) => cur.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (item: Omit<ToastItem, "id">) => {
      const id = ++seq.current;
      setItems((cur) => [...cur.slice(-2), { ...item, id }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach((t) => clearTimeout(t));
  }, []);

  const show = useCallback((message: string, tone: "info" | "error" = "info") => push({ message, tone }), [push]);

  const undoAction = useCallback(
    async (a: DoneAction) => {
      removeAction(a);
      try {
        if (a.undo) await a.undo();
        else for (const id of [...a.ids].reverse()) await postUndo(id);
        await refreshV2(qc);
        clearPatches();
        show(`Undone: ${a.label.charAt(0).toLowerCase()}${a.label.slice(1)}`);
      } catch (err) {
        show(errorSentence(err, "This change could not be undone."), "error");
      }
    },
    [qc, show],
  );

  const done = useCallback(
    (action: DoneAction) => {
      pushAction(action);
      push({ message: action.label, tone: "info", action });
    },
    [push],
  );

  const undoLast = useCallback(async () => {
    if (!peekAction()) {
      show("Nothing to undo in this session.");
      return;
    }
    const a = popAction();
    if (a) await undoAction(a);
  }, [show, undoAction]);

  const api = useMemo<ToastApi>(() => ({ show, done, undoLast }), [show, done, undoLast]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="m2-toasts" role="region" aria-label="Change notices" aria-live="polite" data-testid="toasts">
        {items.map((t) => (
          <div key={t.id} className="m2-toast" data-tone={t.tone} role={t.tone === "error" ? "alert" : "status"}>
            <span className="m2-toast-m">{t.message}</span>
            {t.action ? (
              <>
                <span className="m2-dot" aria-hidden="true" />
                <button
                  type="button"
                  className="m2-toast-b"
                  onClick={() => {
                    dismiss(t.id);
                    void undoAction(t.action as DoneAction);
                  }}
                >
                  Undo
                </button>
              </>
            ) : null}
            <button type="button" className="m2-toast-x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <IconClose />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
