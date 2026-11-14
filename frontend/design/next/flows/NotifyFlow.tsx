"use client";

import { t } from "@/lib/v2/i18n";
import { NotificationsSection } from "@/design/v2/admin/notify";
import { Sheet } from "../kit";
import { LegacyScope } from "../shell/LegacyMount";
import type { SheetCtx } from "../shell/SheetHost";

/** Notification channels as a sheet, using the existing section. */
export function NotifyFlow({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("Notifications")} size="large" under={ctx.under}>
      <LegacyScope><NotificationsSection /></LegacyScope>
    </Sheet>
  );
}
