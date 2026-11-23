"use client";

import { resolveShareLink } from "@/lib/api/v2/roles";
import { t } from "@/lib/v2/i18n";
import { Button, Card, EmptyState } from "@/ui/kit";
import { Gate, day, useQ } from "./common";

export function Share({ token }: { token: string }) {
  const q = useQ(["share", token], () => resolveShareLink(token));
  return (
    <section className="mx-col" aria-labelledby="share-h">
      <h1 id="share-h" className="mx-card-t">{t("Shared with you")}</h1>
      <Gate q={q} label={t("Opening the shared link")}>
        {(l) => (
          <Card title={l.label ?? l.route} sub={t("Read-only view")}>
            <div className="mx-col">
              <p className="mx-muted">{t("Shared by {name}, valid until {date}.", { name: l.shared_by ?? t("a colleague"), date: day(l.expires_at) })}</p>
              <p><Button variant="primary" href={l.route}>{t("Open the shared page")}</Button></p>
            </div>
          </Card>
        )}
      </Gate>
      {!token ? <EmptyState heading={t("This link is not valid")} body={t("Ask the sender for a new link.")} /> : null}
    </section>
  );
}
