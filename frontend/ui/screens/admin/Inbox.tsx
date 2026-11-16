"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotifications, putRead, putReadAll } from "@/lib/api/v2/inbox";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, Card, DataTable } from "@/ui/kit";
import { Row, Sec, errText, when } from "./ops/shared";
import { useToast } from "@/ui/kit";

/** The inbox: every notification, newest first, with mark read and a link to what it is about. */
export function Inbox() {
  const f = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const key = ["v2", "inbox", f];
  const q = useQuery({ queryKey: key, queryFn: () => getNotifications(100) });
  const rows = q.data?.items ?? [];
  const unread = rows.filter((r) => !r.is_read).length;
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await qc.invalidateQueries({ queryKey: key }); } catch (e) { toast(errText(e), "bad"); }
  };
  return (
    <Sec title={t("Inbox")} scope="inbox" q={[q]} context={t("{n} unread", { n: unread })}
      facts={[t("{n} notifications are unread.", { n: unread })]}
      actions={<Button variant="secondary" disabled={unread === 0} onClick={() => act(putReadAll)}>{t("Mark all read")}</Button>}>
      <Card title={t("Notifications")}>
        {rows.length === 0 ? <p className="mx-muted">{t("Your inbox is empty.")}</p> : (
          <DataTable label={t("Notifications")} rows={rows} rowKey={(r) => r.id} height={480}
            columns={[
              { key: "title", label: t("Notification"), render: (r) => (r.is_read ? r.title : <strong>{r.title}</strong>) },
              { key: "body", label: t("Detail"), render: (r) => r.body },
              { key: "at", label: t("Received"), render: (r) => when(r.created_at) },
              { key: "act", label: t("Actions"), render: (r) => (
                <Row>
                  {r.link ? <Button variant="ghost" href={r.link}>{t("Open")}</Button> : null}
                  {r.is_read ? null : <Button variant="ghost" onClick={() => act(() => putRead(r.id))}>{t("Mark read")}</Button>}
                </Row>
              ) },
            ]} />
        )}
      </Card>
    </Sec>
  );
}
