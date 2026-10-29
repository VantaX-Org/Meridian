"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { User, UserStatus } from "@/types/api";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useLicence, useRoles, useUsers } from "@/lib/v2/admin-queries";
import { roleLabel } from "@/lib/roles";
import { STATUS_LABEL, inviteAttention, inviteAttentionSentence, seatsFull, seatsNearlyFull, seatsSentence, userStatus, USER_STATUSES } from "@/lib/users";
import { Grid, type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame, Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Dialog, Fld, NeedsPermission, Note, StatusWord, since, useCan } from "./kit";

const STATUS_TONE: Record<UserStatus, "go" | "at-risk" | "no-go" | "neutral"> = { active: "go", invited: "at-risk", invite_expired: "no-go", locked: "no-go", suspended: "neutral" };

export function UserStatusWord({ user }: { user: User }) {
  const s = userStatus(user);
  return <StatusWord tone={STATUS_TONE[s]}>{STATUS_LABEL[s]}</StatusWord>;
}

/** The roles a person holds, once each, in grant order; before any grant, the role on the account. */
export function roleNames(u: User): string {
  const names = Array.from(new Set((u.grants ?? []).map((g) => (g.role_name || roleLabel(g.role_key)).replace(/\s*\(legacy\)\s*$/i, ""))));
  return names.length ? names.join(", ") : roleLabel(u.role);
}

const COLUMNS: GridColumn<User>[] = [
  {
    id: "user",
    header: "User",
    width: 280,
    pin: true,
    locked: true,
    cell: (u) => (
      <span title={u.email}>
        {u.name} <span className="m2-meta">{u.email}</span>
      </span>
    ),
  },
  { id: "roles", header: "Roles", width: 240, cell: (u) => roleNames(u) },
  { id: "status", header: "Status", width: 150, cell: (u) => <UserStatusWord user={u} /> },
  { id: "login", header: "Last sign-in", width: 140, cell: (u) => since(u.last_login) },
  { id: "since", header: "Member since", width: 140, defaultHidden: true, cell: (u) => since(u.created_at) },
];

const BULK_DONE: Record<api.BulkAction, string> = { suspend: "Suspended", reactivate: "Reactivated", resend: "Invitation sent to", reset: "Password reset for" };

function ImportDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("email,name,role\n");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof api.previewUserImport>> | null>(null);
  const { outcome, pending, run } = useOutcome();
  const check = () =>
    void run("check", async () => {
      const p = await api.previewUserImport(csv);
      setPreview(p);
      return { tone: p.rejected ? "info" : "ok", title: `${p.accepted} ready, ${p.rejected} rejected`, detail: p.seats.ok ? undefined : `Only ${p.seats.available ?? 0} seats are free for ${p.seats.needed} people.` };
    });
  const go = () =>
    void run("import", async () => {
      const r = await api.importUsers(csv);
      await refreshAdmin(qc, "users");
      await refreshAdmin(qc, "licence");
      setPreview(null);
      return { tone: r.skipped.length ? "info" : "ok", title: `Invited ${r.created.length} ${r.created.length === 1 ? "person" : "people"}`, detail: r.skipped.length ? `${r.skipped.length} skipped: ${r.skipped.map((s) => `line ${s.line} ${s.error}`).join("; ")}` : undefined };
    });
  return (
    <Dialog title="Import users" description="One person per line: email, name, role. The first line may be the column names. Each person gets an invitation." onClose={onClose} wide>
      <label className="m2-fld">
        <span className="m2-lbl">CSV</span>
        <textarea rows={6} value={csv} onChange={(e) => (setCsv(e.target.value), setPreview(null))} spellCheck={false} aria-label="CSV" />
      </label>
      <label className="m2-fld">
        <span className="m2-lbl">Or choose a file</span>
        <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void e.target.files?.[0]?.text().then((t) => (setCsv(t), setPreview(null)))} />
      </label>
      {preview ? (
        <div className="m2-frame" tabIndex={0} style={{ maxHeight: 200 }}>
          <table className="m2-tbl">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Email</th>
                <th scope="col">Role</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td>{r.email}</td>
                  <td>{r.role}</td>
                  <td>{r.ok ? <StatusWord tone="go">Ready</StatusWord> : <StatusWord tone="no-go">{r.error ?? "Rejected"}</StatusWord>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="m2-btn" disabled={pending !== null || !csv.trim()} onClick={check}>
          {pending === "check" ? "Checking…" : "Check the file"}
        </button>
        <button type="button" className="m2-btn m2-strong" disabled={pending !== null || !preview || preview.accepted === 0 || !preview.seats.ok} onClick={go}>
          {pending === "import" ? "Importing…" : preview ? `Invite ${preview.accepted}` : "Invite"}
        </button>
      </div>
    </Dialog>
  );
}

/** Admin › Users: everyone who can sign in, with invite, import, bulk actions and a person's inspector behind each row. */
export function UsersSection() {
  const can = useCan();
  const qc = useQueryClient();
  const { openItem, open } = useOpenItem();
  const allowed = can("manage_users");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState<UserStatus | "">("");
  const [importing, setImporting] = useState(false);
  const [suspend, setSuspend] = useState<{ rows: User[]; clear: () => void } | null>(null);
  const filters = useMemo(() => ({ q: search.trim() || undefined, role: role || undefined, status: status || undefined }), [search, role, status]);
  const users = useUsers(filters, allowed);
  const everyone = useUsers({}, allowed);
  const roles = useRoles(allowed);
  const licence = useLicence();
  const { outcome, pending, run } = useOutcome();
  if (!allowed) return <AdminPage title="Users"><NeedsPermission what="Managing users" permission="manage_users" /></AdminPage>;

  const seats = { used: licence.data?.seats_used ?? everyone.data?.users.filter((u) => u.is_active).length ?? 0, limit: licence.data?.features?.max_users ?? licence.data?.seats ?? null };
  const attention = inviteAttentionSentence(inviteAttention(everyone.data?.users ?? []));
  const nameOf = (id: string) => everyone.data?.users.find((u) => u.id === id)?.name ?? id;

  const bulk = (rows: User[], action: api.BulkAction, clear: () => void) =>
    void run(`bulk-${action}`, async () => {
      const r = await api.bulkUsers(rows.map((u) => u.id), action);
      await refreshAdmin(qc, "users");
      clear();
      const ok = r.results.filter((x) => x.ok);
      const bad = r.results.filter((x) => !x.ok);
      return {
        tone: bad.length ? (ok.length ? "info" : "fail") : "ok",
        title: ok.length ? `${BULK_DONE[action]} ${ok.length === 1 ? nameOf(ok[0].id) : `${ok.length} people`}` : "Nothing was changed",
        detail: bad.length ? bad.map((b) => `${nameOf(b.id)}: ${b.error ?? "not changed"}`).join("; ") : undefined,
      };
    });

  const toolbar = (
    <div className="m2-fbar" role="search" aria-label="Filter users" style={{ marginBottom: 0 }}>
      <Fld label="Search">
        <input type="search" value={search} placeholder="Name or email" onChange={(e) => setSearch(e.target.value)} />
      </Fld>
      <Fld label="Role">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Any role</option>
          {(roles.data ?? []).map((r) => (
            <option key={r.key} value={r.key}>
              {r.name}
            </option>
          ))}
        </select>
      </Fld>
      <Fld label="Status">
        <select value={status} onChange={(e) => setStatus(e.target.value as UserStatus | "")}>
          <option value="">Any status</option>
          {USER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </Fld>
    </div>
  );
  const rows = users.data?.users ?? [];
  const filtered = !!(filters.q || filters.role || filters.status);

  return (
    <AdminPage
      title="Users"
      lead={`${seatsSentence(seats)}. A person's roles are grants: open a row to add or remove them.`}
      actions={
        <>
          <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "user", id: "new" })}>
            Invite a user
          </button>
          <button type="button" className="m2-btn" onClick={() => setImporting(true)}>
            Import users
          </button>
        </>
      }
    >
      {seatsFull(seats) ? <Note tone="bad">{`No seats left: ${seatsSentence(seats)}. A new invitation fails until someone is suspended or the licence grants more.`}</Note> : seatsNearlyFull(seats) ? <Note tone="warn">{`Seats are nearly used up: ${seatsSentence(seats)}.`}</Note> : null}
      {attention ? <Note tone="warn">{`Invitations need attention: ${attention}. Resend them or remove the ones nobody will accept.`}</Note> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Block>
        <Grid<User>
          id="admin-users"
          ariaLabel="Users"
          columns={COLUMNS}
          rows={rows}
          rowId={(u) => u.id}
          toolbar={toolbar}
          loading={users.isPending}
          error={users.isError ? <ErrorFrame onRetry={() => void users.refetch()}>{`The users could not be read. ${apiErrorMessage(users.error)}`}</ErrorFrame> : undefined}
          emptyFrame={
            <EmptyFrame
              action={
                filtered ? (
                  <button type="button" className="m2-btn" onClick={() => (setSearch(""), setRole(""), setStatus(""))}>
                    Clear filters
                  </button>
                ) : (
                  <button type="button" className="m2-btn" onClick={() => openItem({ kind: "user", id: "new" })}>
                    Invite a user
                  </button>
                )
              }
            >
              {filtered ? "No one matches these filters." : "No users yet. Invite the first steward or analyst."}
            </EmptyFrame>
          }
          onOpen={(u) => openItem({ kind: "user", id: u.id })}
          openRowId={open?.kind === "user" ? open.id : null}
          selectable
          bulkLabel={(n) => `${n} ${n === 1 ? "person" : "people"}`}
          bulkBar={({ selected, clear }) => (
            <>
              <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => bulk(selected, "resend", clear)}>
                Resend invites
              </button>
              <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => bulk(selected, "reset", clear)}>
                Reset passwords
              </button>
              <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => bulk(selected, "reactivate", clear)}>
                Reactivate
              </button>
              <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => setSuspend({ rows: selected, clear })}>
                Suspend
              </button>
            </>
          )}
        />
        <p className="m2-prov">
          {"Opening a person shows their grants, what they can do now, and every action on the account. "}
          <Mono>j</Mono>
          {" and "}
          <Mono>k</Mono>
          {" move, Enter opens."}
        </p>
      </Block>
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
      {suspend ? (
        <Confirm
          title={`Suspend ${suspend.rows.length} ${suspend.rows.length === 1 ? "person" : "people"}`}
          body="They are signed out and cannot sign in until someone reactivates them. Their work stays where it is."
          confirm="Suspend"
          danger
          onCancel={() => setSuspend(null)}
          onConfirm={() => {
            bulk(suspend.rows, "suspend", suspend.clear);
            setSuspend(null);
          }}
        />
      ) : null}
    </AdminPage>
  );
}
