"use client";

import { useRouter } from "next/navigation";
import { useV2Href } from "@/lib/v2/hooks";
import { PageTitle, V2Link } from "../../parts";
import { ConnectionForm } from "./ConnectionForm";
import { t } from "@/lib/v2/i18n";

/** `/s/new`: connect a system. After it is saved the new system opens, ready to test, extract, schedule and analyse. */
export function ConnectCanvas() {
  const router = useRouter();
  const v2 = useV2Href();
  return (
    <>
      <PageTitle>{t("Connect a system")}</PageTitle>
      <p className="m2-note">
        {t("Meridian reads from SAP and never writes to it. Enter the connection, test it, and connect. Then extract the objects you want checked.")}{" "}
        <V2Link href="/">{t("Back to the landscape")}</V2Link>
      </p>
      <div className="m2-sec" style={{ marginTop: 16 }}>
        <ConnectionForm onSaved={(s) => router.replace(v2(`/s/${s.id}?open=system:${s.id}`))} />
      </div>
    </>
  );
}
