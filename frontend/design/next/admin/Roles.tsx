"use client";

import { useState } from "react";
import { useRoles, useRolesMatrix } from "@/lib/v2/admin-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, Chip } from "../kit";
import { Denied, LongText, QueryView } from "../more/states";

/** Roles with the people count; "Show the matrix" opens what each role may do, per resource and action. */
export function Roles() {
  const { can } = useV2Session();
  const allowed = can("manage_users");
  const roles = useRoles(allowed);
  const [matrix, setMatrix] = useState(false);
  const m = useRolesMatrix(allowed && matrix);
  if (!allowed) return <Denied what={t("Roles and permissions")} />;
  const list = roles.data ?? [];
  return (
    <div className="nx-body">
      <div className="nx-row">
        <Button onClick={() => setMatrix((v) => !v)} aria-pressed={matrix}>{matrix ? t("Hide the matrix") : t("Show the matrix")}</Button>
      </div>
      <QueryView loading={roles.isLoading} error={roles.error} onRetry={() => void roles.refetch()} empty={list.length === 0} emptyHeading={t("No roles")} label={t("Loading roles")}>
        <table className="nx-table">
          <caption className="nx-sub">{t("Roles")}</caption>
          <thead><tr><th scope="col">{t("Role")}</th><th scope="col">{t("What it is for")}</th><th scope="col">{t("People")}</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.key}>
                <th scope="row"><LongText text={r.name} />{r.built_in ? <Chip>{t("Built in")}</Chip> : null}</th>
                <td><LongText text={r.description ?? ""} /></td>
                <td>{r.users ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </QueryView>
      {matrix ? (
        <QueryView loading={m.isLoading} error={m.error} onRetry={() => void m.refetch()} empty={!m.data || m.data.roles.length === 0} emptyHeading={t("No permissions to show")} label={t("Loading the matrix")}>
          {m.data ? (
            <div className="nx-vlist" tabIndex={0} data-testid="matrix">
              <table className="nx-table">
                <caption className="nx-sub">{t("What each role may do")}</caption>
                <thead><tr><th scope="col">{t("Permission")}</th>{m.data.roles.map((r) => <th key={r.key} scope="col"><LongText text={r.name} /></th>)}</tr></thead>
                <tbody>
                  {m.data.resources.flatMap((res) => m.data!.actions.map((a) => (
                    <tr key={`${res}.${a}`}>
                      <th scope="row">{res} {a}</th>
                      {m.data!.roles.map((r) => <td key={r.key}>{r.matrix[res]?.[a] ? t("Yes") : t("No")}</td>)}
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
          ) : null}
        </QueryView>
      ) : null}
    </div>
  );
}
