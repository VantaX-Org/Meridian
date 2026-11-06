"use client";

import { t } from "@/lib/v2/i18n";
import { EmptyFrame, PageTitle, V2Link } from "../parts";
import { Lede } from "../RunParts";
import { CcPage } from "./cc-parts";

/**
 * Evidence ledger, shell only. The list of checked facts arrives with a later backend step, so for now the screen says
 * what it will hold and where to go meanwhile.
 */
export function AletheiaEvidence() {
  const title = t("Evidence ledger");
  return (
    <CcPage title={title}>
      <PageTitle>{title}</PageTitle>
      <Lede>{t("This page will list each fact Aletheia checked, with the run it was checked in and what it found.")}</Lede>
      <EmptyFrame action={<V2Link className="m2-btn m2-next" href="/aletheia-survivorship">{t("Open verified survivorship")}</V2Link>}>
        {t("Aletheia evidence will appear here after the next checked run")}
      </EmptyFrame>
    </CcPage>
  );
}
