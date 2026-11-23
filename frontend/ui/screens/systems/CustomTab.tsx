"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { detectZ } from "@/lib/api/v2/sys";
import { useZAnomalies, useZDormant, useZDrift, useZGhost, useZMapping, useZRegistry } from "@/lib/v2/sys-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, DataTable, FieldChip, SeverityPill, useToast, EmptyState } from "@/ui/kit";
import { errMsg, Gate } from "./shared";

export function CustomTab({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const reg = useZRegistry();
  const an = useZAnomalies();
  const ghost = useZGhost();
  const dormant = useZDormant();
  const drift = useZDrift();
  const map = useZMapping();
  const [busy, setBusy] = useState(false);
  const detect = async () => {
    setBusy(true);
    try { await detectZ(id); toast(t("Custom object detection queued."), "good"); await qc.invalidateQueries({ queryKey: ["v2"] }); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  return (
    <div className="mx-col">
      <Card title={t("Custom objects")} sub={t("Z objects found in this landscape. The lists cover every system.")} action={me.can("trigger_sync") ? <Button variant="secondary" disabled={busy} onClick={() => void detect()}>{t("Detect custom objects")}</Button> : undefined}>
        <Gate q={reg} empty={{ heading: t("No custom objects found yet"), body: t("Run detection to list them.") }}>
          {(d) => d.entries.length === 0 ? <EmptyState heading={t("No custom objects found yet.")} body={t("Run an extraction to find the custom objects.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} description={r.description ?? undefined} /> },
              { key: "module", label: t("Module"), render: (r) => r.module },
              { key: "category", label: t("Category"), render: (r) => r.category },
              { key: "standard_equivalent", label: t("Standard equivalent"), render: (r) => (r.standard_equivalent ? <FieldChip code={r.standard_equivalent ?? ""} /> : "-") },
              { key: "status", label: t("Status"), render: (r) => r.status },
              { key: "transaction_count_total", label: t("Uses"), align: "end" as const, render: (r) => whole(r.transaction_count_total) },
            ]} rows={d.entries} rowKey={(r) => String(r.id)} label={t("Custom object registry")} height={300} />
          )}
        </Gate>
      </Card>
      <Card title={t("Anomalies")}>
        <Gate q={an} empty={{ heading: t("No anomalies") }}>
          {(d) => d.anomalies.length === 0 ? <EmptyState heading={t("No anomalies.")} body={t("Nothing unusual was found in the custom objects.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} description={r.description ?? undefined} /> },
              { key: "anomaly_type", label: t("Type"), render: (r) => r.anomaly_type },
              { key: "severity", label: t("Severity"), render: (r) => <SeverityPill sev={r.severity === "critical" ? "critical" : r.severity === "high" ? "high" : "info"} label={r.severity} /> },
              { key: "deviation_pct", label: t("Deviation"), align: "end" as const, render: (r) => `${whole(r.deviation_pct)}%` },
            ]} rows={d.anomalies} rowKey={(r) => String(r.id)} label={t("Custom object anomalies")} height={240} />
          )}
        </Gate>
      </Card>
      <Card title={t("Ghost and dormant")}>
        <Gate q={ghost} empty={{ heading: t("No ghost objects") }}>
          {(g) => (
            <Gate q={dormant} empty={{ heading: t("No dormant objects") }}>
              {(dm) => g.length + dm.length === 0 ? <EmptyState heading={t("No ghost or dormant objects.")} body={t("Every custom object is in use.")} /> : (
                <DataTable columns={[
                  { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
                  { key: "kind", label: t("Kind"), render: (r) => r.kind },
                  { key: "module", label: t("Module"), render: (r) => r.module },
                ]} rows={[...g.map((x) => ({ ...x, kind: t("Ghost") })), ...dm.map((x) => ({ ...x, kind: t("Dormant") }))]} rowKey={(r) => `${r.kind}-${r.object_name}`} label={t("Ghost and dormant objects")} height={240} />
              )}
            </Gate>
          )}
        </Gate>
      </Card>
      <Card title={t("Drift and standard mapping")}>
        <Gate q={drift} empty={{ heading: t("No drift") }}>
          {(d) => d.length === 0 ? <EmptyState heading={t("No custom object drift.")} body={t("Custom objects match the last run.")} /> : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
              { key: "change_type", label: t("Change"), render: (r) => r.change_type },
              { key: "module", label: t("Module"), render: (r) => r.module },
            ]} rows={d} rowKey={(r) => `${r.object_name}-${r.change_type}`} label={t("Custom object drift")} height={200} />
          )}
        </Gate>
        <Gate q={map} empty={{ heading: t("No standard mapping") }}>
          {(d) => d.mappings.length === 0 ? null : (
            <DataTable columns={[
              { key: "object_name", label: t("Object"), render: (r) => <FieldChip code={r.object_name} /> },
              { key: "standard_equivalent", label: t("Standard equivalent"), render: (r) => (r.standard_equivalent ? <FieldChip code={r.standard_equivalent} /> : null) },
              { key: "confidence", label: t("Confidence"), align: "end" as const, render: (r) => `${Math.round(r.confidence * 100)}%` },
            ]} rows={d.mappings} rowKey={(r) => r.object_name} label={t("Standard mapping")} height={200} />
          )}
        </Gate>
      </Card>
    </div>
  );
}
