"use client";

import { useState } from "react";
import { MAX_WINDOWS, putMaintenance, type MaintenanceWindow } from "@/lib/api/v2/maintenance";
import { t } from "@/lib/v2/i18n";
import { Button, DataTable, Field, Input } from "@/ui/kit";
import { Row, useAct, when } from "./shared";

/** Adds and removes maintenance windows. The PUT replaces the whole list, so every change sends the full list. Times go out in UTC. */
export function MaintenanceEditor({ windows }: { windows: MaintenanceWindow[] }) {
  const { run, busy } = useAct("status");
  const [title, setTitle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detail, setDetail] = useState("");
  const full = windows.length >= MAX_WINDOWS;
  const ok = title.trim() !== "" && from !== "" && to !== "" && !full;
  const add = async () => {
    const w: MaintenanceWindow = { title: title.trim(), starts_at: new Date(from).toISOString(), ends_at: new Date(to).toISOString(), detail: detail.trim() || null };
    if (await run(() => putMaintenance([...windows, w]), t("Maintenance window added"))) { setTitle(""); setFrom(""); setTo(""); setDetail(""); }
  };
  return (
    <>
      {windows.length === 0 ? null : (
        <DataTable label={t("Maintenance windows")} rows={windows} rowKey={(r) => r.id ?? r.starts_at} height={200}
          columns={[
            { key: "title", label: t("Title"), render: (r) => r.title },
            { key: "from", label: t("From"), render: (r) => when(r.starts_at) },
            { key: "to", label: t("To"), render: (r) => when(r.ends_at) },
            { key: "rm", label: "", render: (r) => <Button variant="ghost" disabled={busy} onClick={() => void run(() => putMaintenance(windows.filter((w) => w !== r)), t("Maintenance window removed"))}>{t("Remove")}</Button> },
          ]} />
      )}
      <Field label={t("Title")}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Row>
        <Field label={t("From")}><Input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label={t("To")}><Input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </Row>
      <Field label={t("Detail")} hint={full ? t("The list is full.") : undefined}><Input value={detail} onChange={(e) => setDetail(e.target.value)} /></Field>
      <Button variant="primary" disabled={!ok || busy} onClick={() => void add()}>{t("Add maintenance window")}</Button>
    </>
  );
}
