"use client";

import { postUndo } from "@/lib/api/v2/work";
import { t } from "@/lib/v2/i18n";
import { UndoToast } from "@/ui/kit";
import { useDo } from "./shared";

/** Shows the last change and reverses it with POST /work/undo. */
export function UndoBar({ message, actionId, onDone }: { message: string; actionId: string | null; onDone: () => void }) {
  const run = useDo();
  if (!actionId) return null;
  return <UndoToast message={message} actionLabel={t("Undo")} onAction={async () => { if (await run(() => postUndo(actionId), () => t("The change is undone."))) onDone(); }} />;
}
