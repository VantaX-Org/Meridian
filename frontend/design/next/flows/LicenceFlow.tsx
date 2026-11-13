"use client";

import { t } from "@/lib/v2/i18n";
import { LicenceSection } from "@/design/v2/admin/tenant";
import { Sheet } from "../kit";
import { LegacyScope } from "../shell/LegacyMount";
import type { SheetCtx } from "../shell/SheetHost";

/** The licence as a sheet. The existing secure section owns every key field; this adds none. */
export function LicenceFlow({ ctx }: { ctx: SheetCtx }) {
  return (
    <Sheet open onClose={ctx.close} title={t("Licence")} size="large" under={ctx.under}>
      <LegacyScope><LicenceSection /></LegacyScope>
    </Sheet>
  );
}
