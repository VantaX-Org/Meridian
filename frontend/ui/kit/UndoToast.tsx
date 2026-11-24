"use client";

import { useEffect } from "react";
import { Button } from "./Button";

/** The last change with a one-step Undo. Render it only while there is something to undo. Ctrl or Cmd Z fires it too. */
export function UndoToast({ message, actionLabel, onAction }: { message: string; actionLabel: string; onAction: () => void }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        const el = e.target as HTMLElement | null;
        if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
        e.preventDefault();
        onAction();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onAction]);
  return (
    <div className="mx-undo" role="status">
      <span>{message}</span>
      <Button variant="ghost" onClick={onAction}>{actionLabel}</Button>
    </div>
  );
}
