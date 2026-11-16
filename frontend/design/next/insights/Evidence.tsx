"use client";

import Link from "next/link";
import { t } from "@/lib/v2/i18n";
import { EmptyState } from "../kit";
import { Mark } from "./parts";

/**
 * Evidence ledger. The list of checked facts arrives with a later backend step (no ledger API yet), so the screen says
 * what it will hold and where to go meanwhile.
 */
export function Evidence() {
  return (
    <div className="nx-body" data-testid="ins-evidence">
      <Mark />
      <p className="nx-sub">{t("This page will list each fact Aletheia checked, with the run it was checked in and what it found.")}</p>
      <EmptyState
        heading={t("Evidence ledger")}
        action={<Link className="nx-btn nx-btn-secondary" href="/more/aletheia?tab=survivorship">{t("Open verified survivorship")}</Link>}
      >
        {t("Aletheia evidence will appear here after the next checked run")}
      </EmptyState>
    </div>
  );
}
