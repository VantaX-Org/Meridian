"use client";

import { useMemo, useState } from "react";
import { useV2Session } from "@/lib/v2/hooks";
import { useUsers } from "@/lib/v2/admin-queries";
import { STATUS_TONE, userStatus } from "@/lib/users";
import { t } from "@/lib/v2/i18n";
import type { UserStatus } from "@/types/api";
import { Button, Chip } from "../kit";
import { ListSearch, LongText, QueryView, VirtualList } from "../more/states";
import { useSheets } from "../shell/SheetHost";
import { Denied } from "../more/states";

export const statusText = (s: UserStatus): string =>
  ({ invited: t("Invited"), invite_expired: t("Invite expired"), active: t("Active"), locked: t("Locked"), suspended: t("Suspended") })[s];
const TONE = { go: "good", "at-risk": "warn", "no-go": "bad", info: "accent", neutral: "neutral" } as const;

/** Users: search, then a window onto the list. Rows open the person sheet; Invite opens the invite sheet. */
export function Users() {
  const { can } = useV2Session();
  const sheets = useSheets();
  const q = useUsers({}, can("manage_users"));
  const [find, setFind] = useState("");
  const users = useMemo(() => q.data?.users ?? [], [q.data]);
  const shown = useMemo(() => {
    const n = find.trim().toLowerCase();
    return n ? users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(n)) : users;
  }, [users, find]);
  if (!can("manage_users")) return <Denied what={t("Users and roles")} />;
  const invite = <Button variant="primary" onClick={() => sheets.open({ kind: "invite", id: "new" })}>{t("Invite a person")}</Button>;
  return (
    <div className="nx-body">
      <div className="nx-row">{invite}</div>
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={users.length === 0} emptyHeading={t("No users yet")} emptyText={t("Invite the first person to give them access.")} emptyAction={invite} label={t("Loading users")}>
        <ListSearch value={find} onChange={setFind} label={t("Search users")} />
        {shown.length === 0 ? <p className="nx-sub">{t("No user matches this search.")}</p> : (
          <VirtualList rows={shown} rowKey={(u) => u.id} label={t("Users")} render={(u) => {
            const s = userStatus(u);
            return (
              <button type="button" className="nx-row" onClick={() => sheets.open({ kind: "person", id: u.id })}>
                <LongText text={u.name || u.email} className="nx-row-main" />
                <LongText text={u.email} className="nx-sub" />
                <Chip tone={TONE[STATUS_TONE[s]]}>{statusText(s)}</Chip>
              </button>
            );
          }} />
        )}
      </QueryView>
    </div>
  );
}
