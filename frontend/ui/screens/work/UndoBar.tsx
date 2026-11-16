"use client";

import { postUndo } from "@/lib/api/v2/work";
import { t } from "@/lib/v2/i18n";
import { Button } from "@/ui/kit";
import { useDo } from "./shared";

/** Local kit request: a toast with an Undo action. Shows the last change and reverses it with POST /work/undo. */
export function UndoBar({ message, actionId, onDone }: { message: string; actionId: string | null; onDone: () => void }) {
  const run = useDo();
  if (!actionId) return null;
  return (
    <div className="mx-row" role="status">
      <span>{message}</span>
      <Button variant="ghost" onClick={async () => { if (await run(() => postUndo(actionId), () => t("The change is undone."))) onDone(); }}>{t("Undo")}</Button>
    </div>
  );
}
