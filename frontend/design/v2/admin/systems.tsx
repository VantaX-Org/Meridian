"use client";

import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import type { SAPSystemExtended } from "@/types/api";
import { type GridColumn } from "../Grid";
import { ToolGrid } from "../GridTools";
import { EmptyFrame, ErrorFrame, Mono, V2Link } from "../parts";
import { AdminPage, Block, NeedsPermission, Note, StatusWord, useCan } from "./kit";

const editHref = (s: SAPSystemExtended) => `/s/${s.id}?open=connection:${s.id}`;

const HEALTH = (): Record<string, [tone: "go" | "at-risk" | "no-go" | "neutral", text: string]> => ({
  healthy: ["go", t("Connected")],
  degraded: ["at-risk", t("Degraded")],
  unreachable: ["no-go", t("Not reachable")],
  auth_failed: ["no-go", t("Sign-in refused")],
});

const columns = (): GridColumn<SAPSystemExtended>[] => [
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
];

export function SystemsSection() {
  const allowed = useCan()("manage_systems");
  const q = useSystemsExtended();
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
      <Block>
        <ToolGrid<SAPSystemExtended>
          toolsTitle={t("SAP systems")}
          id="admin-sap-systems"
          ariaLabel={t("SAP systems")}
          columns={columns()}
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
