"use client";

import { t } from "@/lib/v2/i18n";
import { NotificationsSectionNative } from "../admin/notify";
import { Sheet } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";

/** Notification defaults as a sheet, drawn with the native section. */
export function NotifyFlow({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("Notifications")} size="large" under={ctx.under}>
      <NotificationsSectionNative />
    </Sheet>
  );
}
