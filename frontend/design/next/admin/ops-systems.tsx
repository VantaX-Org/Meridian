"use client";

import { useState } from "react";
import { deleteSystem } from "@/lib/api/v2/sys";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { systemTypeText } from "@/lib/v2/labels";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import type { SAPSystemExtended } from "@/types/api";
import { Button, Chip, Code, Confirm, DataTable, useToast, type Column } from "../kit";
import { Denied, KeepLink } from "../more/states";
import { OpsBlock, OpsPage, TONE, type V2Tone } from "./ops-kit";

const editHref = (s: SAPSystemExtended) => `/s/${s.id}?open=connection:${s.id}`;

const HEALTH = (): Record<string, [tone: V2Tone, text: string]> => ({
  healthy: ["go", t("Connected")],
  degraded: ["at-risk", t("Degraded")],
  unreachable: ["no-go", t("Not reachable")],
  auth_failed: ["no-go", t("Sign-in refused")],
});

/** Admin > SAP systems: each connected system, a connection test and removal. Connection settings open the system's own sheet; nothing here sends a password. */
export function OpsSystems() {
  const { can } = useV2Session();
  const allowed = can("manage_systems");
  const q = useSystemsExtended();
  const toast = useToast();
  const refresh = useRefreshV2();
  const [busy, setBusy] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SAPSystemExtended | null>(null);
  const test = async (s: SAPSystemExtended) => {
    setBusy(s.id);
    try {
      const r = await testSystemConnection(s.id);
      toast({ tone: r.connected ? "good" : "bad", text: r.connected ? t("{name} is connected. {message}", { name: s.name, message: r.message }) : t("{name} could not be reached. {message}", { name: s.name, message: r.message }) });
      refresh();
    } catch (e) {
      toast({ tone: "bad", text: t("The test of {name} failed. {detail}", { name: s.name, detail: apiErrorMessage(e) }) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!removing) return;
    const target = removing;
    setBusy(target.id);
    try {
      await deleteSystem(target.id);
      toast({ tone: "good", text: t("{name} removed", { name: target.name }) });
      refresh();
    } catch (e) {
      toast({ tone: "bad", text: t("{name} could not be removed. {detail}", { name: target.name, detail: apiErrorMessage(e) }) });
    } finally {
      setRemoving(null);
      setBusy(null);
    }
  };
  if (!allowed) return <Denied what={t("Managing SAP systems")} />;
  const connect = <KeepLink href="/s/new" className="nx-btn nx-btn-primary">{t("Connect a system")}</KeepLink>;
  const columns: Column<SAPSystemExtended>[] = [
    { id: "name", label: t("Name"), cell: (s) => s.name, compare: (a, b) => a.name.localeCompare(b.name) },
    { id: "type", label: t("System type"), cell: (s) => systemTypeText(s.system_type) },
    { id: "host", label: t("Host or address"), cell: (s) => <Code code={s.host || s.base_url || "-"} /> },
    { id: "client", label: t("Client"), cell: (s) => <Code code={s.client || "-"} /> },
    { id: "sysnr", label: t("Instance"), cell: (s) => <Code code={s.sysnr || "-"} /> },
    { id: "env", label: t("Environment"), cell: (s) => s.environment ?? "-" },
    { id: "health", label: t("Connection"), cell: (s) => { const [tone, text] = HEALTH()[s.health_status ?? ""] ?? ["neutral", t("Not checked")]; return <Chip tone={TONE[tone]}>{text}</Chip>; } },
    { id: "checked", label: t("Last checked"), cell: (s) => (s.last_health_check ? formatDate(s.last_health_check) : "-") },
    { id: "edit", label: t("Settings"), cell: (s) => <KeepLink href={editHref(s)} className="nx-link">{t("Connection settings")}</KeepLink> },
    {
      id: "actions", label: t("Actions"), cell: (s) => (
        <span className="nx-ops-actions">
          <Button size={32} disabled={busy !== null} loading={busy === s.id} loadingLabel={t("Testing…")} aria-label={t("Test the connection of {name}", { name: s.name })} onClick={() => void test(s)}>{t("Test connection")}</Button>
          <Button size={32} variant="quiet" aria-label={t("Remove {name}", { name: s.name })} onClick={() => setRemoving(s)}>{t("Remove")}</Button>
        </span>
      ),
    },
  ];
  return (
    <OpsPage lead={t("Each connected system and its connection settings: host, client, instance and sign-in. Connect a new one here.")} actions={connect}>
      <p className="nx-note">{t("Changing the host, client or instance number asks for the password again. Stored passwords are never shown.")}</p>
      <Confirm
        open={!!removing}
        title={removing ? t("Remove {name}?", { name: removing.name }) : ""}
        consequence={t("Its credentials and schedules go with it. Extracted runs and findings stay.")}
        confirmLabel={t("Remove system")}
        danger
        phrase={removing?.name}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      <OpsBlock>
        <DataTable<SAPSystemExtended>
          caption={t("SAP systems")}
          rows={q.data ?? []}
          rowKey={(s) => s.id}
          rowLabel={(s) => s.name}
          columns={columns}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The systems could not be read. {detail}", { detail: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No system connected yet."), action: connect }}
        />
      </OpsBlock>
    </OpsPage>
  );
}
