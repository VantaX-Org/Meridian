"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ToastApi } from "@/design/v2/Toast";
import { errorSentence, postUndo } from "@/lib/api/v2/work";
import { isTyping } from "@/lib/v2/keys";
import { lcFirst, t } from "@/lib/v2/i18n";
import { refreshV2 } from "@/lib/v2/queries";
import { peekAction, popAction, pushAction, removeAction, type DoneAction } from "@/lib/v2/undo";
import { clearPatches } from "@/lib/v2/work-overrides";
import { useToast } from "../kit";

/**
 * The v2 change notices for native screens: the same undo stack (lib/v2/undo) and the same POST /actions/undo per
 * action id, shown through the kit toast with its Undo button. Pass the result to useWorkActions so a decision made
 * on a native screen can be taken back from the notice or with Cmd+Z.
 */
export function useNativeWorkToast(): ToastApi {
  const push = useToast();
  const qc = useQueryClient();

  const show = useCallback((message: string, tone: "info" | "error" = "info") => push({ text: message, tone: tone === "error" ? "bad" : "neutral" }), [push]);

  const undoAction = useCallback(
    async (a: DoneAction) => {
      removeAction(a);
      try {
        if (a.undo) await a.undo();
        else for (const id of [...a.ids].reverse()) await postUndo(id);
        await refreshV2(qc);
        clearPatches();
        show(t("Undone: {action}", { action: lcFirst(a.label) }));
      } catch (err) {
        show(errorSentence(err, t("This change could not be undone.")), "error");
      }
    },
    [qc, show],
  );

  const done = useCallback(
    (a: DoneAction) => {
      pushAction(a);
      push({ text: a.label, tone: "good", onUndo: () => void undoAction(a) });
    },
    [push, undoAction],
  );

  const undoLast = useCallback(async () => {
    if (!peekAction()) {
      show(t("Nothing to undo in this session."));
      return;
    }
    const a = popAction();
    if (a) await undoAction(a);
  }, [show, undoAction]);

  return useMemo<ToastApi>(() => ({ show, done, undoLast }), [show, done, undoLast]);
}

/** Cmd+Z (Ctrl+Z) takes back the last change, as in v2: not while typing, not with Shift or Alt. */
export function useUndoKey(undoLast: () => void | Promise<void>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.shiftKey || e.altKey || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      if (isTyping(e.target)) return;
      e.preventDefault();
      void undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoLast]);
}
