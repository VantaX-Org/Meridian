"use client";

import { t } from "@/lib/v2/i18n";
import { LicenceSectionNative } from "../admin/tenant";
import { Sheet } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";

/** The licence as a sheet, drawn with the native section. That section owns every key field; this adds none. */
export function LicenceFlow({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("Licence")} size="large" under={ctx.under}>
      <LicenceSectionNative />
    </Sheet>
  );
}
