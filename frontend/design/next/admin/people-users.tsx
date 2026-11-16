"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import type { User, UserStatus } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import * as ent from "@/lib/api/v2/enterprise";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useLicence, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { useScimGroupRoles, useScimToken } from "@/lib/v2/enterprise-queries";
import { inviteAttention, seatsFull, seatsNearlyFull, userStatus, USER_STATUSES } from "@/lib/users";
import { inviteAttentionText, roleText, seatsText, userStatusText } from "@/lib/v2/labels";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, Confirm, DataTable, Sheet, useToast, type Column } from "../kit";
import { Denied, useSubmitGuard } from "../more/states";
import { useSheets } from "../shell/SheetHost";
import { Block, CopyButton, Field, Loaded, Notes, Page, Since, TONE } from "./people-kit";

const STATUS_TONE: Record<UserStatus, keyof typeof TONE> = { active: "go", invited: "at-risk", invite_expired: "no-go", locked: "no-go", suspended: "neutral" };

/** The roles a person holds, once each by name, in grant order; before any grant, the role on the account. */
function userRoles(u: User): { key: string; name: string }[] {
  const byName = new Map<string, string>();
  for (const g of u.grants ?? []) {
    const name = (g.role_name || roleText(g.role_key)).replace(/\s*\(legacy\)\s*$/i, "");
    if (!byName.has(name)) byName.set(name, g.role_key);
  }
  return byName.size ? Array.from(byName, ([name, key]) => ({ key, name })) : [{ key: u.role, name: roleText(u.role) }];
}

function RolesCell({ user }: { user: User }) {
  const roles = useRoles();
  const held = userRoles(user).map((r) => ({ ...r, description: roles.data?.find((x) => x.key === r.key)?.description ?? null }));
  return (
    <span title={held.map((r) => (r.description ? `${r.name}: ${r.description}` : r.name)).join("\n")}>
      {held.map((r, i) => (
        <Fragment key={r.key}>
          {i ? "; " : ""}
          {r.name}
          {r.description ? <span className="nx-sub"> {r.description}</span> : null}
        </Fragment>
      ))}
    </span>
  );
}

const columns = (): Column<User>[] => [
  { id: "user", label: t("User"), cell: (u) => <span title={u.email}>{u.name} <span className="nx-sub">{u.email}</span></span>, compare: (a, b) => a.name.localeCompare(b.name) },
  { id: "roles", label: t("Roles"), cell: (u) => <RolesCell user={u} /> },
  { id: "status", label: t("Status"), cell: (u) => { const s = userStatus(u); return <Chip tone={TONE[STATUS_TONE[s]]}>{userStatusText(s)}</Chip>; } },
  { id: "login", label: t("Last sign-in"), cell: (u) => <Since at={u.last_login} /> },
  { id: "since", label: t("Member since"), hidden: true, cell: (u) => <Since at={u.created_at} /> },
];

const bulkDone = (a: api.BulkAction): string => ({ suspend: t("Suspended"), reactivate: t("Reactivated"), resend: t("Invitation sent to"), reset: t("Password reset for") })[a];

/** Import users from CSV: check first, then invite the accepted rows. */
function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles();
  const [csv, setCsv] = useState("email,name,role\n");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewUserImport>> | null>(null);
  const [pending, setPending] = useState<"check" | "import" | null>(null);
  const { run } = useSubmitGuard();
  const edit = (v: string) => (setCsv(v), setPreview(null));
  const check = () =>
    void run(async () => {
      setPending("check");
      try {
        const p = await api.previewUserImport(csv);
        setPreview(p);
        const title = t("{accepted} ready, {rejected} rejected", { accepted: p.accepted, rejected: p.rejected });
        const detail = p.seats.ok ? "" : ` ${t("Only {available} seats are free for {needed} people.", { available: p.seats.available ?? 0, needed: p.seats.needed })}`;
        toast({ text: title + detail, tone: p.rejected ? "neutral" : "good" });
      } catch (e) {
        toast({ text: apiErrorMessage(e), tone: "bad" });
      } finally {
        setPending(null);
      }
    });
  const go = () =>
    void run(async () => {
      setPending("import");
      try {
        const r = await api.importUsers(csv);
        await refreshAdmin(qc, "users");
        await refreshAdmin(qc, "licence");
        setPreview(null);
        const title = t("Invited {createdCount} {createdCount, plural, one {person} other {people}}", { createdCount: r.created.length });
        const detail = r.skipped.length ? ` ${t("{skippedCount} skipped: {map}", { skippedCount: r.skipped.length, map: r.skipped.map((s) => t("line {line} {error}", { line: s.line, error: s.error })).join("; ") })}` : "";
        toast({ text: title + detail, tone: r.skipped.length ? "neutral" : "good" });
      } catch (e) {
        toast({ text: apiErrorMessage(e), tone: "bad" });
      } finally {
        setPending(null);
      }
    });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("Import users")}
      meta={t("One person per line: email, name, role. The first line may be the column names. Each person gets an invitation.")}
      size="large"
      secondary={<Button loading={pending === "check"} loadingLabel={t("Checking…")} disabled={pending !== null || !csv.trim()} onClick={check}>{t("Check the file")}</Button>}
      primary={
        <Button variant="primary" loading={pending === "import"} loadingLabel={t("Importing…")} disabled={pending !== null || !preview || preview.accepted === 0 || !preview.seats.ok} onClick={go}>
          {preview ? t("Invite {accepted}", { accepted: preview.accepted }) : t("Invite")}
        </Button>
      }
    >
      <div className="nx-ppl-form">
        <Field label="CSV" wide>
          <textarea className="nx-ppl-csv" rows={6} value={csv} onChange={(e) => edit(e.target.value)} spellCheck={false} aria-label="CSV" />
        </Field>
        <Field label={t("Or choose a file")} wide>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void e.target.files?.[0]?.text().then(edit)} />
        </Field>
      </div>
      {preview ? (
        <div className="nx-ppl-scroll" tabIndex={0}>
          <table className="nx-ppl-table">
            <thead>
              <tr>
                <th scope="col">{t("Line")}</th>
                <th scope="col">{t("Email")}</th>
                <th scope="col">{t("Role")}</th>
                <th scope="col">{t("Result")}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.email}</td>
                  <td><Code code={r.role} text={roles.data?.find((x) => x.key === r.role)?.name} /></td>
                  <td>{r.ok ? <Chip tone="good">{t("Ready")}</Chip> : <Chip tone="bad">{r.error ?? t("Rejected")}</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Sheet>
  );
}

/** Admin users: everyone who can sign in, with invite, import, bulk actions, and the person sheet behind each row. */
export function UsersSection() {
  const { can } = useV2Session();
  const href = useV2Href();
  const qc = useQueryClient();
  const sheets = useSheets();
  const toast = useToast();
  const allowed = can("manage_users");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [importing, setImporting] = useState(false);
  const [suspend, setSuspend] = useState<string[] | null>(null);
  const [epoch, setEpoch] = useState(0);
  const filters = useMemo(() => ({ q: search.trim() || undefined, role: role || undefined, status: status || undefined }), [search, role, status]);
  const users = useUsers(filters, allowed);
  const everyone = useUsers({}, allowed);
  const roles = useRoles(allowed);
  const licence = useLicence();
  const { busy, run } = useSubmitGuard();
  if (!allowed) return <Denied what={t("Managing users")} />;

  const seats = { used: licence.data?.seats_used ?? everyone.data?.users.filter((u) => u.is_active).length ?? 0, limit: licence.data?.features?.max_users ?? licence.data?.seats ?? null };
  const attention = inviteAttentionText(inviteAttention(everyone.data?.users ?? []));
  const nameOf = (id: string) => everyone.data?.users.find((u) => u.id === id)?.name ?? id;
  const invite = () => sheets.open({ kind: "invite", id: "new" });

  const bulk = (ids: string[], action: api.BulkAction) =>
    void run(async () => {
      try {
        const r = await api.bulkUsers(ids, action);
        await refreshAdmin(qc, "users");
        setEpoch((n) => n + 1); // remounts the table, which clears the selection as v2 clear() did
        const ok = r.results.filter((x) => x.ok);
        const bad = r.results.filter((x) => !x.ok);
        const title = ok.length ? `${bulkDone(action)} ${ok.length === 1 ? nameOf(ok[0].id) : t("{okCount} people", { okCount: ok.length })}` : t("Nothing was changed");
        const detail = bad.length ? `. ${bad.map((b) => `${nameOf(b.id)}: ${b.error ?? t("not changed")}`).join("; ")}` : "";
        toast({ text: title + detail, tone: bad.length ? (ok.length ? "neutral" : "bad") : "good" });
      } catch (e) {
        toast({ text: apiErrorMessage(e), tone: "bad" });
      }
    });

  const rows = users.data?.users ?? [];
  const filtered = !!(filters.q || filters.role || filters.status);
  const seatsSentence = seatsText(seats);

  return (
    <Page
      lead={t("{seatsSentence}. A person's roles are grants: open a row to add or remove them.", { seatsSentence })}
      actions={
        <>
          <Button variant="primary" onClick={invite}>{t("Invite a user")}</Button>
          <Button onClick={() => setImporting(true)}>{t("Import users")}</Button>
        </>
      }
    >
      <div className="nx-row"><Link className="nx-link" href={href("/more/admin/roles")}>{t("Roles and permissions")}</Link></div>
      {seatsFull(seats) ? (
        <p className="nx-ppl-bad" role="status">{t("No seats left: {seatsSentence}. A new invitation fails until someone is suspended or the licence grants more.", { seatsSentence })}</p>
      ) : seatsNearlyFull(seats) ? (
        <p className="nx-sub" role="status">{t("Seats are nearly used up: {seatsSentence}.", { seatsSentence })}</p>
      ) : null}
      {attention ? <p className="nx-sub" role="status">{t("Invitations need attention: {attention}. Resend them or remove the ones nobody will accept.", { attention })}</p> : null}
      <Block>
        <div className="nx-ppl-acts" role="search" aria-label={t("Filter users")}>
          <Field label={t("Search")}>
            <input type="search" value={search} placeholder={t("Name or email")} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label={t("Role")}>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t("Any role")}</option>
              {(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </select>
          </Field>
          <Field label={t("Status")}>
            <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "")}>
              <option value="">{t("Any status")}</option>
              {USER_STATUSES.map((s) => <option key={s} value={s}>{userStatusText(s)}</option>)}
            </select>
          </Field>
        </div>
        <DataTable<User>
          key={epoch}
          rows={rows}
          columns={columns()}
          rowKey={(u) => u.id}
          rowLabel={(u) => u.name || u.email}
          caption={t("Users")}
          loading={users.isPending}
          error={users.isError ? { sentence: t("The users could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(users.error) }), onRetry: () => void users.refetch() } : undefined}
          empty={
            filtered
              ? { heading: t("No one matches these filters."), action: <Button onClick={() => (setSearch(""), setRole(""), setStatus(""))}>{t("Clear filters")}</Button> }
              : { heading: t("No users yet. Invite the first steward or analyst."), action: <Button onClick={invite}>{t("Invite a user")}</Button> }
          }
          onOpenRow={(u) => sheets.open({ kind: "person", id: u.id })}
          selectable
          bulkActions={(ids) => (
            <>
              <span className="nx-sub">{t("{n} {n, plural, one {person} other {people}}", { n: ids.length })}</span>
              <Button size={32} disabled={busy} onClick={() => bulk(ids, "resend")}>{t("Resend invites")}</Button>
              <Button size={32} disabled={busy} onClick={() => bulk(ids, "reset")}>{t("Reset passwords")}</Button>
              <Button size={32} disabled={busy} onClick={() => bulk(ids, "reactivate")}>{t("Reactivate")}</Button>
              <Button size={32} disabled={busy} onClick={() => setSuspend(ids)}>{t("Suspend")}</Button>
            </>
          )}
        />
        <p className="nx-sub">{t("Opening a person shows their grants, what they can do now, and every action on the account. ")}</p>
      </Block>
      <ScimCard />
      <ImportSheet open={importing} onClose={() => setImporting(false)} />
      <Confirm
        open={suspend !== null}
        title={t("Suspend {rowsCount} {rowsCount, plural, one {person} other {people}}", { rowsCount: suspend?.length ?? 0 })}
        consequence={t("They are signed out and cannot sign in until someone reactivates them. Their work stays where it is.")}
        confirmLabel={t("Suspend")}
        danger
        onCancel={() => setSuspend(null)}
        onConfirm={() => {
          if (suspend) bulk(suspend, "suspend");
          setSuspend(null);
        }}
      />
    </Page>
  );
}

/** The SCIM token, shown once at creation or rotation; Meridian keeps only a hash of it. */
function OneTimeSecret({ value, onDone }: { value: string; onDone: () => void }) {
  return (
    <div className="nx-ppl-secret" data-testid="scim-secret">
      <p className="nx-sub">{t("Shown once. Copy the token now and paste it into your identity provider: Meridian keeps only a hash of it.")}</p>
      <input readOnly value={value} aria-label={t("SCIM token")} onFocus={(e) => e.currentTarget.select()} spellCheck={false} />
      <div className="nx-ppl-acts">
        <CopyButton text={value} label={t("Copy the token")} />
        <Button variant="quiet" size={32} onClick={onDone}>{t("I have stored it")}</Button>
      </div>
    </div>
  );
}

/** Provisioning (SCIM): token status, create, rotate and revoke, then the group to role mapping. */
export function ScimCard() {
  const { can } = useV2Session();
  const qc = useQueryClient();
  const toast = useToast();
  const write = can("manage_system");
  const q = useScimToken(write);
  const [secret, setSecret] = useState<string | null>(null);
  const [asking, setAsking] = useState<"rotate" | "revoke" | null>(null);
  const { busy, run } = useSubmitGuard();
  if (!write) return null;
  const fail = (e: unknown) => toast({ text: apiErrorMessage(e), tone: "bad" });
  const rotate = (first: boolean) =>
    void run(async () => {
      try {
        const r = await ent.rotateScimToken();
        setSecret(r.token ?? null);
        await refreshAdmin(qc, "scim");
        toast({ text: first ? `${t("Token created")}. ${t("Paste it into your identity provider with the base URL.")}` : `${t("Token rotated")}. ${t("The previous token stopped working. Paste the new one into your identity provider.")}`, tone: "good" });
      } catch (e) {
        fail(e);
      }
    });
  const revoke = () =>
    void run(async () => {
      try {
        await ent.revokeScimToken();
        setSecret(null);
        await refreshAdmin(qc, "scim");
        toast({ text: `${t("Token revoked")}. ${t("Create a new token to start provisioning again.")}`, tone: "good" });
      } catch (e) {
        fail(e);
      }
    });
  return (
    <Block testid="scim-card" title={t("Provisioning (SCIM)")} hint={t("Microsoft Entra ID, Okta and other identity providers create, update and suspend people here through SCIM 2.0. Give them the base URL and a token.")}>
      <Loaded q={q} what={t("The SCIM token")} rows={2}>
        {(s) => (
          <>
            <Notes
              rows={[
                [t("Token"), <Chip key="s" tone={s.configured ? "good" : "neutral"}>{s.configured ? t("Active") : t("No token")}</Chip>],
                [t("Token prefix"), s.token_prefix ? <Code code={s.token_prefix} /> : "—"],
                [t("Created"), s.created_at ? formatDate(s.created_at, "datetime") : "—"],
                [t("Last used"), s.last_used_at ? <Since at={s.last_used_at} /> : "—"],
                [t("SCIM base URL"), <span key="u" className="nx-ppl-acts"><Code code={s.base_url} /><CopyButton text={s.base_url} label={t("Copy the URL")} /></span>],
              ]}
            />
            {secret ? <OneTimeSecret value={secret} onDone={() => setSecret(null)} /> : null}
            <div className="nx-ppl-acts">
              {s.configured ? (
                <>
                  <Button disabled={busy} onClick={() => setAsking("rotate")}>{t("Rotate the token")}</Button>
                  <Button variant="danger" disabled={busy} onClick={() => setAsking("revoke")}>{t("Revoke")}</Button>
                </>
              ) : (
                <Button variant="primary" loading={busy} loadingLabel={t("Creating…")} onClick={() => rotate(true)}>{t("Create a token")}</Button>
              )}
            </div>
          </>
        )}
      </Loaded>
      <GroupRoles />
      <Confirm
        open={asking === "rotate"}
        title={t("Rotate the SCIM token")}
        consequence={t("The current token stops working at once. Until the new one is in your identity provider, nobody is provisioned or suspended.")}
        confirmLabel={t("Rotate")}
        onCancel={() => setAsking(null)}
        onConfirm={() => (setAsking(null), rotate(false))}
      />
      <Confirm
        open={asking === "revoke"}
        title={t("Revoke the SCIM token")}
        consequence={t("Provisioning stops. People already provisioned keep their accounts; changes in the identity provider stop reaching Meridian.")}
        confirmLabel={t("Revoke")}
        danger
        onCancel={() => setAsking(null)}
        onConfirm={() => (setAsking(null), revoke())}
      />
    </Block>
  );
}

function GroupRoles() {
  const q = useScimGroupRoles();
  return (
    <section className="nx-ppl-block" aria-label={t("Group to role")}>
      <h3 className="nx-ppl-h3">{t("Group to role")}</h3>
      <p className="nx-sub">{t("A person in one of these identity provider groups gets its role. Saving re-syncs everyone in a SCIM group at once.")}</p>
      <Loaded q={q} what={t("The group mapping")} rows={3}>
        {(m) => <GroupRoleEditor key={JSON.stringify(m.mappings)} initial={m} />}
      </Loaded>
    </section>
  );
}

type Row = { group: string; role: string; id: number };
const dupKey = (g: string) => g.trim().replace(/\s+/g, " ").toLowerCase();

function GroupRoleEditor({ initial }: { initial: ent.ScimMappings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles();
  const [rows, setRows] = useState<Row[]>(() => initial.mappings.map((m, i) => ({ group: m.group, role: m.role, id: i })));
  const [next, setNext] = useState(initial.mappings.length);
  const { busy, run } = useSubmitGuard();
  const known = useMemo(() => new Map(initial.mappings.map((m) => [m.group.trim().toLowerCase(), m])), [initial]);
  const roleOptions = roles.data?.length ? roles.data.map((r) => ({ key: r.key, name: r.name })) : initial.mappings.map((m) => ({ key: m.role, name: m.role_name }));
  const counts = new Map<string, number>();
  for (const r of rows) if (r.group.trim()) counts.set(dupKey(r.group), (counts.get(dupKey(r.group)) ?? 0) + 1);
  const dupes = [...counts.values()].some((n) => n > 1);
  const empty = rows.some((r) => !r.group.trim());
  const ok = !empty && !dupes;
  const patch = (id: number, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const save = () =>
    void run(async () => {
      try {
        const r = await ent.putScimGroupRoles(rows.map(({ group, role }) => ({ group: group.trim(), role })));
        await refreshAdmin(qc, "scim");
        const n = r.resynced_users;
        toast({ text: n != null ? `${t("Mapping saved")}. ${t("{n, plural, one {# person was} other {# people were}} re-synced to the new roles.", { n })}` : t("Mapping saved"), tone: "good" });
      } catch (e) {
        toast({ text: apiErrorMessage(e), tone: "bad" });
      }
    });
  return (
    <div role="region" aria-label={t("Group to role mapping")}>
      {rows.length === 0 ? (
        <p className="nx-sub">{t("No group is mapped. Everyone provisioned keeps the role given here.")}</p>
      ) : (
        <div className="nx-ppl-scroll">
          <table className="nx-ppl-table">
            <thead>
              <tr>
                <th scope="col">{t("Identity provider group")}</th>
                <th scope="col">{t("Role in Meridian")}</th>
                <th scope="col">{t("Members")}</th>
                <th scope="col"><span className="nx-sr">{t("Remove")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const saved = known.get(r.group.trim().toLowerCase());
                const count = i + 1;
                return (
                  <tr key={r.id}>
                    <td><input value={r.group} aria-label={t("Group {count}", { count })} onChange={(e) => patch(r.id, { group: e.target.value })} /></td>
                    <td>
                      <select value={r.role} aria-label={t("Role for group {count}", { count })} onChange={(e) => patch(r.id, { role: e.target.value })}>
                        {roleOptions.some((o) => o.key === r.role) ? null : <option value={r.role}>{saved?.role_name ?? r.role}</option>}
                        {roleOptions.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                      </select>
                    </td>
                    <td>{saved ? (saved.group_exists ? saved.members : t("Not sent yet")) : "—"}</td>
                    <td><Button variant="quiet" size={32} aria-label={t("Remove group {count}", { count })} onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>{t("Remove")}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="nx-sub">{t("Members counts the people the identity provider has put in the group. Not sent yet: the provider has not sent a group of that name.")}</p>
      {empty ? <p className="nx-ppl-bad" role="alert">{t("Every row needs a group name.")}</p> : null}
      {dupes ? <p className="nx-ppl-bad" role="alert">{t("A group can map to one role only.")}</p> : null}
      <div className="nx-ppl-acts">
        <Button
          disabled={roleOptions.length === 0}
          onClick={() => {
            setRows((rs) => [...rs, { group: "", role: roleOptions[roleOptions.length - 1].key, id: next }]);
            setNext((n) => n + 1);
          }}
        >
          {t("Add a group")}
        </Button>
        <Button variant="primary" loading={busy} loadingLabel={t("Saving…")} disabled={!ok} onClick={save}>{t("Save the mapping")}</Button>
      </div>
    </div>
  );
}
