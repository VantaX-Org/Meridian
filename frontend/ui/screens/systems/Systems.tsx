"use client";

import { useCrumbs } from "@/ui/screens/flow";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { deleteSystem } from "@/lib/api/v2/sys";
import { testSystemConnection } from "@/lib/api/v2/runs";
import { runKeys, useSystemsExtended } from "@/lib/v2/runs-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import type { SAPSystemExtended } from "@/types/api";
import { Button, Confirm, DataTable, EmptyState, ErrorState, PageHeader, Search, Skeleton, useAletheia, useAletheiaScope, useToast, type Column } from "@/ui/kit";
import Link from "next/link";
import { Health, envLabel, errMsg, typeLabel, when } from "./shared";

export function Systems() {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const fx = useFixture();
  const href = (p: string) => withFixture(p, fx);
  const q = useSystemsExtended();
  const qc = useQueryClient();
  const toast = useToast();
  const chat = useAletheia();
  const me = useV2Session();
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [drop, setDrop] = useState<SAPSystemExtended | null>(null);
  const systems = useMemo(() => q.data ?? [], [q.data]);
  const rows = useMemo(() => systems.filter((s) => `${s.name} ${s.host ?? ""} ${s.system_type}`.toLowerCase().includes(find.trim().toLowerCase())), [systems, find]);
  const manage = me.can("manage_systems");

  useAletheiaScope({
    key: "systems",
    label: t("Asking about your systems"),
    suggestions: [t("Which system needs attention?"), t("When did each system last sync?")],
    answer: (prompt) => {
      const bad = systems.filter((s) => s.health_status && s.health_status !== "healthy" && s.health_status !== "unknown");
      if (prompt === t("Which system needs attention?")) {
        return { text: bad.length ? t("{n} systems need attention: {names}.", { n: bad.length, names: bad.map((s) => s.name).join(", ") }) : t("Every tested system is healthy.") };
      }
      return { text: systems.map((s) => `${s.name}: ${when(s.last_sync_at)}`).join("; ") || t("No system is connected yet.") };
    },
  });

  const test = async (s: SAPSystemExtended) => {
    setBusy(s.id);
    try {
      const r = await testSystemConnection(s.id);
      toast(r.connected ? t("{name} answered.", { name: s.name }) : t("{name} did not answer: {why}", { name: s.name, why: r.message }), r.connected ? "good" : "bad");
      await qc.invalidateQueries({ queryKey: runKeys.systems(fx) });
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(null); }
  };
  const remove = async () => {
    const s = drop;
    if (!s) return;
    setDrop(null);
    try {
      await deleteSystem(s.id);
      toast(t("{name} was removed.", { name: s.name }), "good");
      await qc.invalidateQueries({ queryKey: runKeys.systems(fx) });
    } catch (e) { toast(errMsg(e), "bad"); }
  };

  const cols: Column<SAPSystemExtended>[] = [
    { key: "name", label: t("System"), sort: (s) => s.name, render: (s) => <Link href={href(`/s/${s.id}`)}>{s.name}</Link> },
    { key: "type", label: t("Type"), sort: (s) => s.system_type, render: (s) => typeLabel(s.system_type) },
    { key: "env", label: t("Environment"), render: (s) => envLabel(s.environment) },
    { key: "role", label: t("Role"), render: (s) => (s.role === "target" ? t("Target") : t("Source")) },
    { key: "health", label: t("Health"), sort: (s) => s.health_status ?? "", render: (s) => <Health value={s.health_status} /> },
    { key: "sync", label: t("Last sync"), sort: (s) => s.last_sync_at ?? "", render: (s) => when(s.last_sync_at) },
    {
      key: "act", label: t("Actions"), render: (s) => (
        <span className="mx-links">
          <Button variant="ghost" disabled={busy === s.id} onClick={() => void test(s)}>{busy === s.id ? t("Testing") : t("Test connection")}</Button>
          <Button variant="ghost" href={href(`/s/${s.id}`)}>{t("Open")}</Button>
          {manage ? <Button variant="ghost" onClick={() => setDrop(s)}>{t("Delete")}</Button> : null}
        </span>
      ),
    },
  ];

  if (q.isLoading) return <Skeleton lines={8} label={t("Loading your systems")} />;
  if (q.isError) return <ErrorState heading={t("Your systems could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;

  return (
    <>
      <PageHeader crumbs={crumbs("systems")}
        title={t("Systems")}
        context={t("{n} connected", { n: systems.length })}
        actions={<>
          <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
          {manage ? <Button variant="primary" href={href("/s/new")}>{t("Connect a system")}</Button> : null}
        </>}
      />
      {systems.length === 0 ? (
        <EmptyState heading={t("No system is connected")} body={t("Connect your first SAP system to extract data and measure its quality.")} action={manage ? <Button variant="primary" href={href("/s/new")}>{t("Connect a system")}</Button> : undefined} />
      ) : (
        <div className="mx-col">
          <Search value={find} onChange={setFind} label={t("Search systems")} clearLabel={t("Clear search")} placeholder={t("Name, host or type")} />
          <DataTable columns={cols} rows={rows} rowKey={(s) => s.id} label={t("Connected systems")} height={420} rowHeight={48} />
        </div>
      )}
      <Confirm open={drop !== null} danger title={t("Remove {name}?", { name: drop?.name ?? "" })} confirmLabel={t("Remove system")} cancelLabel={t("Cancel")} onConfirm={() => void remove()} onCancel={() => setDrop(null)}>
        <p>{t("Its credentials and schedules are deleted. Extracted runs and findings stay.")}</p>
      </Confirm>
    </>
  );
}
