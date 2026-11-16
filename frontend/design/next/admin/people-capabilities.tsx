"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useV2Session } from "@/lib/v2/hooks";
import { useShareLinks, refreshRoles } from "@/lib/v2/roles-queries";
import { getAllDelegations, revokeDelegation, revokeShareLink, startViewAs } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { ROLE_NAMES, VIEW_AS_ROLES, setViewAs } from "@/lib/v2/view-as";
import { failureText } from "@/lib/v2/errors";
import { labelText } from "@/lib/v2/labels";
import { formatDate } from "@/lib/format";
import { int } from "@/lib/v2/score";
import { lc, t } from "@/lib/v2/i18n";
import { Button, Chip, Code, Confirm, EmptyState } from "../kit";
import { Denied } from "../more/states";
import { Block, Field, Loaded, Page } from "./people-kit";

/** View as a role: start a read-only view of the product as one role sees it. */
export function ViewAsSection() {
  const { can, viewAs } = useV2Session();
  const qc = useQueryClient();
  const [role, setRole] = useState(VIEW_AS_ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!can("manage_users") && !viewAs) return <Denied what={t("Viewing as a role")} />;
  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await startViewAs(role);
      setViewAs(role);
      await qc.invalidateQueries();
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page lead={t("See the product as one role sees it, to answer a support question or check a role before you grant it. Everything is read-only while you view as a role, and starting and stopping are in the audit log.")}>
      <Block>
        {viewAs ? (
          <p className="nx-sub" role="status">{t("You are viewing as {ROLE_NAMES}. Stop from the bar at the top of the page.", { ROLE_NAMES: ROLE_NAMES[viewAs] ?? viewAs })}</p>
        ) : (
          <div className="nx-ppl-acts">
            <Field label={t("Role")}>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {VIEW_AS_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAMES[r] ?? r}</option>)}
              </select>
            </Field>
            <Button variant="primary" loading={busy} onClick={() => void start()}>{t("View as this role")}</Button>
          </div>
        )}
        {error ? <p className="nx-ppl-bad" role="alert">{error}</p> : null}
      </Block>
    </Page>
  );
}

/** Share links: every read-only link of the tenant, revocable while active. */
export function ShareLinksSection() {
  const { can } = useV2Session();
  const qc = useQueryClient();
  const q = useShareLinks(true);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; label: string } | null>(null);
  if (!can("manage_users")) return <Denied what={t("Every share link of the tenant")} />;
  return (
    <Page lead={t("Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once.")}>
      <Loaded q={q} what={t("The share links")}>
        {(d) =>
          d.links.length === 0 ? (
            <EmptyState heading={t("Nobody has shared a page yet.")} />
          ) : (
            <ul className="nx-ppl-list" data-testid="share-links">
              {d.links.map((l) => (
                <li key={l.id}>
                  <Chip tone={l.state_word === "active" ? "good" : "neutral"}>{l.label ?? l.route}</Chip>
                  <span className="nx-sub">{t("{created_by_label}, {value}, opened {open_count} {open_count2, plural, one {time} other {times}}", { created_by_label: l.created_by_label ?? l.created_by, value: l.state_word === "active" ? t("until {expires_at}", { expires_at: formatDate(l.expires_at, "date") }) : lc(labelText(l.state_word)), open_count: int(l.open_count), open_count2: l.open_count })}</span>
                  <Code code={l.route} />
                  {l.state_word === "active" ? <Button variant="quiet" size={32} onClick={() => setAsking({ id: l.id, label: l.label ?? l.route })}>{t("Revoke")}</Button> : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <p className="nx-ppl-bad" role="alert">{error}</p> : null}
      <Confirm
        open={asking !== null}
        title={t("Revoke the share link to {label}", { label: asking?.label ?? "" })}
        consequence={t("The link stops working at once. Anyone who opens it afterwards sees nothing; to share the page again, make a new link.")}
        confirmLabel={t("Revoke")}
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const id = asking?.id;
          setAsking(null);
          if (id) void revokeShareLink(id).then(() => refreshRoles(qc, "links")).catch((e) => setError(failureText(e)));
        }}
      />
    </Page>
  );
}

/** Out of office: every delegation of the tenant; an administrator can end one. */
export function DelegationsSection() {
  const { can } = useV2Session();
  const fx = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["v2", "roles", fx, "delegations", "all"], queryFn: getAllDelegations, enabled: can("manage_users"), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; from: string; to: string } | null>(null);
  if (!can("manage_users")) return <Denied what={t("Everyone's out of office")} />;
  return (
    <Page lead={t("Who is away and who covers their approvals and assigned work. Each person sets their own from Preferences; an administrator can end one.")}>
      <Loaded q={q} what={t("The delegations")}>
        {(d) =>
          d.delegations.length === 0 ? (
            <EmptyState heading={t("Nobody is away.")} />
          ) : (
            <ul className="nx-ppl-list" data-testid="all-delegations">
              {d.delegations.map((x) => (
                <li key={x.id}>
                  <span>{t("{from_name} to {to_name}", { from_name: x.from_name, to_name: x.to_name })}</span>
                  <span className="nx-sub">{t("{starts_on} to {ends_on}, {state}", { starts_on: x.starts_on, ends_on: x.ends_on, state: lc(labelText(x.state)) })}</span>
                  {x.state === "active" || x.state === "scheduled" ? <Button variant="quiet" size={32} onClick={() => setAsking({ id: x.id, from: x.from_name, to: x.to_name })}>{t("End it")}</Button> : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <p className="nx-ppl-bad" role="alert">{error}</p> : null}
      <Confirm
        open={asking !== null}
        title={t("End the out of office of {from_name}", { from_name: asking?.from ?? "" })}
        consequence={t("{to_name} stops covering the approvals and assigned work of {from_name} from now on.", { to_name: asking?.to ?? "", from_name: asking?.from ?? "" })}
        confirmLabel={t("End it")}
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          const id = asking?.id;
          setAsking(null);
          if (id) void revokeDelegation(id).then(() => refreshRoles(qc, "delegations")).catch((e) => setError(failureText(e)));
        }}
      />
    </Page>
  );
}
