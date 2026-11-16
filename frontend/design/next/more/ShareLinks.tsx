"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { revokeShareLink, type ShareLink } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { lc, t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { refreshRoles, useShareLinks } from "@/lib/v2/roles-queries";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, Confirm, useToast } from "../kit";
import { QueryView } from "./states";
import "./journey.css";

/**
 * Share links in the Reports journey (GET /share-links, DELETE /share-links/{id}). Everyone sees the links they made;
 * with manage_users the list is every link of the tenant, as the old administration page showed.
 */
export function ShareLinks() {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const all = session.can("manage_users");
  const readOnly = session.shared || Boolean(session.viewAs);
  const q = useShareLinks(all);
  const [asking, setAsking] = useState<ShareLink | null>(null);
  const links = q.data?.links ?? [];
  const revoke = async (l: ShareLink) => {
    setAsking(null);
    try {
      await revokeShareLink(l.id);
      await refreshRoles(qc, "links");
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  return (
    <section className="nx-form" aria-label={t("Share links")}>
      <p className="nx-sub">{t("Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once.")}</p>
      <QueryView loading={q.isPending} error={q.isError ? t("The share links could not be read.") : null} onRetry={() => void q.refetch()} empty={links.length === 0} emptyHeading={t("Nobody has shared a page yet.")} label={t("Share links")}>
        <ul className="nx-pick" data-testid="share-links">
          {links.map((l) => (
            <li key={l.id} className="nx-row">
              <div className="nx-row-main">
                <Code code={l.route} text={l.label ?? undefined} />
                <div className="nx-sub">
                  {t("{created_by_label}, {value}, opened {open_count} {open_count2, plural, one {time} other {times}}", { created_by_label: l.created_by_label ?? l.created_by, value: l.state_word === "active" ? t("until {expires_at}", { expires_at: formatDate(l.expires_at, "date") }) : lc(labelText(l.state_word)), open_count: int(l.open_count), open_count2: l.open_count })}
                </div>
              </div>
              <Chip tone={l.state_word === "active" ? "good" : "neutral"}>{labelText(l.state_word)}</Chip>
              {l.state_word === "active" ? <Button variant="quiet" size={32} disabled={readOnly} onClick={() => setAsking(l)}>{t("Revoke")}</Button> : null}
            </li>
          ))}
        </ul>
      </QueryView>
      <Confirm
        open={asking !== null}
        title={asking ? t("Revoke the share link to {label}", { label: asking.label ?? asking.route }) : ""}
        consequence={t("The link stops working at once. Anyone who opens it afterwards sees nothing; to share the page again, make a new link.")}
        confirmLabel={t("Revoke")}
        danger
        onConfirm={() => asking && void revoke(asking)}
        onCancel={() => setAsking(null)}
      />
    </section>
  );
}
