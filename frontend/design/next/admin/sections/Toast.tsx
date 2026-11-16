"use client";

import { useMemo } from "react";
import { useToast as useNextToast } from "@/design/next/kit/Toast";
import { failureText } from "@/lib/v2/errors";
import { lcFirst, t } from "@/lib/v2/i18n";
import type { DoneAction } from "@/lib/v2/undo";

/** The admin sections' toast: show a line, or confirm a change with an Undo that runs the section's own reversal. */
export function useToast() {
  const push = useNextToast();
  return useMemo(
    () => ({
      show: (text: string, tone?: "error") => push({ text, tone: tone === "error" ? "bad" : undefined }),
      done: (a: DoneAction) =>
        push({
          text: a.label,
          tone: "good",
          onUndo: a.undo
            ? () =>
                void a
                  .undo?.()
                  .then(() => push({ text: t("Undone: {action}", { action: lcFirst(a.label) }) }))
                  .catch((e: unknown) => push({ text: `${t("This change could not be undone.")} ${failureText(e)}`, tone: "bad" }))
            : undefined,
        }),
    }),
    [push],
  );
}
