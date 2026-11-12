"use client";

import { useState } from "react";
import { deleteSystem } from "@/lib/api/v2/sys";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import type { SAPSystemExtended } from "@/types/api";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { EmptyFrame, ErrorFrame, Mono, V2Link } from "../parts";
import { AdminPage, Block, Confirm, NeedsPermission, Note, StatusWord, useCan, useDone } from "./kit";

const editHref = (s: SAPSystemExtended) => `/s/${s.id}?open=connection:${s.id}`;

const HEALTH = (): Record<string, [tone: "go" | "at-risk" | "no-go" | "neutral", text: string]> => ({
  healthy: ["go", t("Connected")],
  degraded: ["at-risk", t("Degraded")],
  unreachable: ["no-go", t("Not reachable")],
  auth_failed: ["no-go", t("Sign-in refused")],
});

const columns = (act: { test: (s: SAPSystemExtended) => void; remove: (s: SAPSystemExtended) => void; busy: string | null }): GridColumn<SAPSystemExtended>[] => [
  { id: "name", header: t("Name"), width: 200, pin: true, locked: true, cell: (s) => s.name },
  { id: "type", header: t("System type"), width: 160, cell: (s) => systemTypeText(s.system_type) },
  { id: "host", header: t("Host or address"), width: 220, cell: (s) => <Mono>{s.host || s.base_url || "-"}</Mono> },
  { id: "client", header: t("Client"), width: 90, cell: (s) => <Mono>{s.client || "-"}</Mono> },
  { id: "sysnr", header: t("Instance"), width: 90, cell: (s) => <Mono>{s.sysnr || "-"}</Mono> },
  { id: "env", header: t("Environment"), width: 110, cell: (s) => s.environment ?? "-" },
  {
    id: "health",
    header: t("Connection"),
    width: 160,
    cell: (s) => {
      const [tone, text] = HEALTH()[s.health_status ?? ""] ?? ["neutral", t("Not checked")];
      return <StatusWord tone={tone}>{text}</StatusWord>;
    },
  },
  { id: "checked", header: t("Last checked"), width: 150, cell: (s) => (s.last_health_check ? formatDate(s.last_health_check) : "-") },
  { id: "edit", header: t("Settings"), width: 170, cell: (s) => <V2Link href={editHref(s)}>{t("Connection settings")}</V2Link> },
  {
    id: "actions",
    header: t("Actions"),
    width: 220,
    cell: (s) => (
      <span style={{ display: "inline-flex", gap: "var(--m2-s2)" }}>
        <button type="button" className="m2-btn" disabled={act.busy !== null} aria-label={t("Test the connection of {name}", { name: s.name })} onClick={() => act.test(s)}>
          {act.busy === s.id ? t("Testing…") : t("Test connection")}
        </button>
        <button type="button" className="m2-btn m2-ghost" aria-label={t("Remove {name}", { name: s.name })} onClick={() => act.remove(s)}>
          {t("Remove")}
        </button>
      </span>
    ),
  },
];

export function SystemsSection() {
  const allowed = useCan()("manage_systems");
  const q = useSystemsExtended();
  const done = useDone();
  const refresh = useRefreshV2();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SAPSystemExtended | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const test = async (s: SAPSystemExtended) => {
    setBusy(s.id);
    try {
      const r = await testSystemConnection(s.id);
      done(r.connected ? t("{name} is connected. {message}", { name: s.name, message: r.message }) : t("{name} could not be reached. {message}", { name: s.name, message: r.message }));
      refresh();
    } catch (e) {
      setFailure(t("The test of {name} failed. {detail}", { name: s.name, detail: apiErrorMessage(e) }));
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(removing.id);
    try {
      await deleteSystem(removing.id);
      done(t("{name} removed", { name: removing.name }));
      setRemoving(null);
      refresh();
    } catch (e) {
      setFailure(t("{name} could not be removed. {detail}", { name: removing.name, detail: apiErrorMessage(e) }));
      setRemoving(null);
    } finally {
      setBusy(null);
    }
  };
  if (!allowed) {
    return (
      <AdminPage title={t("SAP systems")}>
        <NeedsPermission what={t("Managing SAP systems")} permission="manage_systems" />
      </AdminPage>
    );
  }
  const connect = (
    <V2Link href="/s/new" className="m2-btn m2-next">
      {t("Connect a system")}
    </V2Link>
  );
  return (
    <AdminPage title={t("SAP systems")} lead={t("Each connected system and its connection settings: host, client, instance and sign-in. Connect a new one here.")} actions={connect}>
      <Note>{t("Changing the host, client or instance number asks for the password again. Stored passwords are never shown.")}</Note>
      {failure ? <Note tone="bad">{failure}</Note> : null}
      {removing ? (
        <Confirm
          title={t("Remove {name}?", { name: removing.name })}
          body={t("Its credentials and schedules go with it. Extracted runs and findings stay.")}
          confirm={t("Remove system")}
          danger
          phrase={removing.name}
          pending={busy === removing.id}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      <Block>
        <ToolGrid<SAPSystemExtended>
          toolsTitle={t("SAP systems")}
          id="admin-sap-systems"
          ariaLabel={t("SAP systems")}
          columns={columns({ test: (x) => void test(x), remove: setRemoving, busy })}
          rows={q.data ?? []}
          rowId={(s) => s.id}
          loading={q.isPending}
          error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The systems could not be read. {detail}", { detail: apiErrorMessage(q.error) })}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame action={connect}>{t("No system connected yet.")}</EmptyFrame>}
        />
      </Block>
    </AdminPage>
  );
}
