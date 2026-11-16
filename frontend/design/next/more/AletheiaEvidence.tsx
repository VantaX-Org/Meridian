"use client";

import { t } from "@/lib/v2/i18n";
import { EmptyState, LargeTitle } from "../kit";
import { KeepLink } from "./states";

/**
 * Evidence ledger, shell only. The list of checked facts arrives with a later backend step, so for now the screen says
 * what it will hold and where to go meanwhile.
 */
export function AletheiaEvidence() {
  const title = t("Evidence ledger");
  return (
    <div className="nx-body" data-testid="aletheia-evidence">
      <LargeTitle title={title} subtitle={t("This page will list each fact Aletheia checked, with the run it was checked in and what it found.")} />
      <EmptyState
        heading={t("Aletheia evidence will appear here after the next checked run")}
        action={<KeepLink className="nx-link" href="/more/aletheia?tab=survivorship">{t("Open verified survivorship")}</KeepLink>}
      />
    </div>
  );
}
