"use client";

import Link from "next/link";
import { t } from "@/lib/v2/i18n";
import { AuthFrame } from "./AuthFrame";

/** An address that leads nowhere: one card, one way on. Old addresses are redirected before they get here (next.config.ts). */
export function NotFoundCard() {
  return (
    <AuthFrame title={t("There is nothing at this address")} lead={t("The page may have moved, or the link is wrong. Check the address, or start from the landscape.")}>
      <Link href="/" className="m2-btn m2-next m2-wide">
        {t("Open the landscape")}
      </Link>
    </AuthFrame>
  );
}
