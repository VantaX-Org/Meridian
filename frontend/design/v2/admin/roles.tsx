"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Matrix, Pair, Role } from "@/lib/api/roles";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useAccessRequests, useAudit, useRoles, useRolesMatrix, useUsers } from "@/lib/v2/admin-queries";
import { type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame, Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Dialog, Loaded, NeedsPermission, StatusWord, since, useCan } from "./kit";
import { auditSentence } from "@/lib/v2/audit-sentence";
import { ToolGrid } from "../GridTools";
import { t } from "@/lib/v2/i18n";

export const matrixToPairs = (m: Matrix): Pair[] => Object.entries(m).flatMap(([resource, acts]) => Object.entries(acts).filter(([, on]) => on).map(([action]) => ({ resource, action })));

/** Resource rows by action columns, a checkbox in each cell; read only for a built-in role. */
export function PermissionMatrix({ matrix, editable, base, onToggle }: { matrix: Matrix; editable: boolean; base?: Matrix; onToggle?: (resource: string, action: string, on: boolean) => void }) {
  const resources = Object.keys(matrix);
  const actions = Object.keys(matrix[resources[0]] ?? {});
  return (
    <div className="m2-frame" tabIndex={0} style={{ maxHeight: 420 }}>
      <table className="m2-pmx" aria-label={t("Permissions by resource and action")}>
        <thead>
          <tr>
            <th scope="col">{t("Resource")}</th>
            {actions.map((a) => (
              <th key={a} scope="col">
                {a}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {resources.map((r) => (
            <tr key={r}>
              <td>{r}</td>
              {actions.map((a) => {
                const on = !!matrix[r][a];
                const changed = base ? !!base[r]?.[a] !== on : false;
                return (
                  <td key={a} data-changed={changed ? "true" : undefined}>
                    {editable ? (
                      <input type="checkbox" checked={on} aria-label={`${r} ${a}`} onChange={(e) => onToggle?.(r, a, e.target.checked)} />
                    ) : on ? (
                      <span className="m2-yes" aria-label={t("{r} {a}: allowed", { r, a })}>
                        {t("Yes")}
                      </span>
                    ) : (
                      <span className="m2-no" aria-label={t("{r} {a}: not allowed", { r, a })}>
                        {"—"}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLUMNS: GridColumn<Role>[] = [
  { id: "name", get header() { return t("Role"); }, width: 280, pin: true, locked: true, cell: (r) => r.name },
  { id: "key", get header() { return t("Key"); }, width: 190, cell: (r) => <Mono>{r.key}</Mono> },
  { id: "type", get header() { return t("Type"); }, width: 110, cell: (r) => (r.built_in ? t("Built-in") : t("Custom")) },
  { id: "users", get header() { return t("People"); }, width: 90, numeric: true, cell: (r) => r.users ?? 0 },
  { id: "changed", get header() { return t("Last changed"); }, width: 140, cell: (r) => since(r.updated_at) },
];

function Requests() {
  const qc = useQueryClient();
  const q = useAccessRequests();
  const people = useUsers({});
  const roles = useRoles();
  const [granting, setGranting] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [reason, setReason] = useState("");
  const { outcome, pending, run } = useOutcome();
  const nameOf = (id: string) => people.data?.users.find((u) => u.id === id)?.name ?? id;
  const decide = (id: string, body: Parameters<typeof api.decideAccessRequest>[1], title: string) =>
    void run(id, async () => {
      await api.decideAccessRequest(id, body);
      await refreshAdmin(qc, "users");
      setGranting(null);
      setDeclining(null);
      return { tone: "ok", title };
    });
  const rows = q.data ?? [];
  return (
    <Block title={t("Access requests")} hint={t("People ask for access from the place they were refused. Granting adds a role to them; declining needs a reason they will read.")}>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Loaded q={q} what={t("The requests")} rows={2}>
        {() =>
          rows.length === 0 ? (
            <EmptyFrame>{t("No open requests. A request appears here when someone asks for access they do not have.")}</EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t("Who")}</th>
                    <th scope="col">{t("Asks for")}</th>
                    <th scope="col">{t("Reason")}</th>
                    <th scope="col">{t("Asked")}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>{nameOf(r.user_id)}</td>
                      <td>{t("{action} on {resource}", { action: r.action, resource: r.resource })}</td>
                      <td style={{ whiteSpace: "normal" }}>{r.reason ?? <span className="m2-dash">{"—"}</span>}</td>
                      <td>{since(r.created_at)}</td>
                      <td className="m2-r">
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => (setRole(""), setGranting(r.id))}>
                          {t("Grant")}
                        </button>{" "}
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => (setReason(""), setDeclining(r.id))}>
                          {t("Decline")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loaded>
      {granting ? (
        <Dialog title={t("Grant access")} description={t("Choose the role to add. It applies to the scope they asked about.")} onClose={() => setGranting(null)}>
          <label className="m2-afld">
            <span className="m2-lbl">{t("Role")}</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t("Choose a role")}</option>
              {(roles.data ?? []).map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={() => setGranting(null)}>
              {t("Cancel")}
            </button>
            <button type="button" className="m2-btn m2-strong" disabled={!role || pending !== null} onClick={() => decide(granting, { decision: "granted", role_key: role }, t("Access granted"))}>
              {t("Grant access")}
            </button>
          </div>
        </Dialog>
      ) : null}
      {declining ? (
        <Dialog title={t("Decline the request")} description={t("They see this reason.")} onClose={() => setDeclining(null)}>
          <label className="m2-afld">
            <span className="m2-lbl">{t("Reason")}</span>
            <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={() => setDeclining(null)}>
              {t("Cancel")}
            </button>
            <button type="button" className="m2-btn m2-strong" disabled={!reason.trim() || pending !== null} onClick={() => decide(declining, { decision: "declined", reason: reason.trim() }, t("Request declined"))}>
              {t("Decline")}
            </button>
          </div>
        </Dialog>
      ) : null}
    </Block>
  );
}

function History() {
  const q = useAudit({ limit: 8, entity_type: "roles" });
  return (
    <Block title={t("Recent changes to roles")} hint={t("Role, grant and request changes from the audit log.")}>
      <Loaded q={q} what={t("The history")} rows={3}>
        {(d) =>
          d.entries.length === 0 ? (
            <EmptyFrame>{t("No role changes yet.")}</EmptyFrame>
          ) : (
            <ul className="m2-hist" aria-label={t("Role changes")}>
              {d.entries.map((e) => (
                <li key={e.id}>
                  <span className="m2-d">{since(e.created_at)}</span> {auditSentence(e)}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
    </Block>
  );
}

/** Admin › Roles and permissions: the roles, what each may do, who has asked for more, and the changes made. */
export function RolesSection() {
  const can = useCan();
  const { openItem, open } = useOpenItem();
  const allowed = can("manage_users");
  const roles = useRoles(allowed);
  const matrix = useRolesMatrix(allowed);
  if (!allowed) return <AdminPage title={t("Roles and permissions")}><NeedsPermission what={t("Managing roles")} permission="manage_users" /></AdminPage>;
  return (
    <AdminPage
      title={t("Roles and permissions")}
      lead={t("Built-in roles cannot be changed. Copy one to start a custom role, then set exactly what it may do. Give a role for one system or object only, from a person's grants.")}
      actions={
        <button type="button" className="m2-btn m2-next" onClick={() => openItem({ kind: "role", id: "new" })}>
          {t("Create a role")}
        </button>
      }
    >
      <Block>
        <ToolGrid<Role>
          toolsTitle={t("Roles")}
          id="admin-roles"
          ariaLabel={t("Roles")}
          columns={COLUMNS}
          rows={roles.data ?? []}
          rowId={(r) => r.key}
          loading={roles.isPending}
          error={roles.isError ? <ErrorFrame onRetry={() => void roles.refetch()}>{t("The roles could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(roles.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{t("No roles yet. Built-in roles appear once the tenant is set up.")}</EmptyFrame>}
          onOpen={(r) => openItem({ kind: "role", id: r.key })}
          openRowId={open?.kind === "role" ? open.id : null}
          fixedColumns
        />
      </Block>
      <Block title={t("What each role may do")} hint={t("The actions each role allows, by resource. Open a role to see or change its full matrix.")}>
        <Loaded q={matrix} what={t("The matrix")} rows={3}>
          {(m) => (
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={t("Roles by resource")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Resource")}</th>
                    {m.roles.map((r) => (
                      <th key={r.key} scope="col">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.resources.map((res) => (
                    <tr key={res}>
                      <th scope="row">{res}</th>
                      {m.roles.map((r) => {
                        const acts = m.actions.filter((a) => r.matrix[res]?.[a]);
                        return (
                          <td key={r.key} title={acts.join(", ")}>
                            {acts.length === 0 ? <span className="m2-dash">{"—"}</span> : acts.length === m.actions.length ? t("Everything") : acts.join(", ")}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loaded>
        <p className="m2-prov">
          <StatusWord tone="neutral">{t("Read only here")}</StatusWord>
          {t(" Changes happen in the role's own inspector.")}
        </p>
      </Block>
      <Requests />
      <History />
    </AdminPage>
  );
}
