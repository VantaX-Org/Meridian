"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { discoverConfig, proposeConfigMatches } from "@/lib/api/v2/sys";
import { useConfigCompare, useConfigDrift, useConfigItems } from "@/lib/v2/sys-queries";
import { useSystemConfigLoad } from "@/lib/v2/runs-queries";
import { loadSystemConfig } from "@/lib/api/v2/runs";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, Chip, DataTable, FieldChip, SeverityPill, StatTile, useToast, EmptyState } from "@/ui/kit";
import { errMsg, Gate, when } from "./shared";
import { ProcessCard, RediscoverCard } from "./ConfigProcess";

export function ConfigTab({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const load = useSystemConfigLoad(id);
  const cmp = useConfigCompare(id, null);
  const drift = useConfigDrift();
  const [obj, setObj] = useState<string | null>(null);
  const items = useConfigItems(id, obj ?? "", obj !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { toast(await fn(), "good"); await qc.invalidateQueries({ queryKey: ["v2"] }); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(null); }
  };
  const run = me.can("trigger_sync") || me.can("manage_systems");
  const l = load.data;
  return (
    <div className="mx-col">
      <Card title={t("Configuration read")} sub={t("The customising held in this system.")} action={run ? <Button variant="secondary" disabled={busy !== null} onClick={() => void act("load", async () => { await loadSystemConfig(id); return t("Configuration read started."); })}>{t("Read configuration")}</Button> : undefined}>
        {l ? (
          <dl className="mx-tiles">
            <StatTile label={t("Status")} value={l.status} note={when(l.finished_at ?? l.created_at)} />
            <StatTile label={t("Areas read")} value={`${whole(l.areas_loaded)} / ${whole(l.areas_total)}`} />
            <StatTile label={t("Objects")} value={whole(l.objects.length)} />
          </dl>
        ) : <p className="mx-muted">{t("The configuration has not been read yet.")}</p>}
      </Card>
      <Card title={t("Configuration intelligence")} sub={t("Keys and descriptions against the target, or the SAP standard.")} action={run ? <span className="mx-links"><Button variant="ghost" disabled={busy !== null} onClick={() => void act("disc", async () => { await discoverConfig(id); return t("Configuration discovery queued."); })}>{t("Discover")}</Button><Button variant="secondary" disabled={busy !== null} onClick={() => void act("prop", async () => { const r = await proposeConfigMatches(id); return t("{n} matches proposed.", { n: r.proposed }); })}>{t("Propose matches")}</Button></span> : undefined}>
        <Gate q={cmp} empty={{ heading: t("No comparison yet"), body: t("Read the configuration first.") }}>
          {(d) => d.objects.length === 0 ? <EmptyState heading={t("No comparison yet.")} body={t("Run the configuration twice to compare it.")} /> : (
            <>
              <p className="mx-muted">{t("Compared with {name}", { name: d.target.label })}</p>
              <DataTable columns={[
                { key: "object", label: t("Object"), render: (r) => <FieldChip code={r.object} /> },
                { key: "key_match", label: t("Key match"), align: "end" as const, render: (r) => whole(r.key_match) },
                { key: "desc_match", label: t("Description match"), align: "end" as const, render: (r) => whole(r.desc_match) },
                { key: "missing", label: t("Missing"), align: "end" as const, render: (r) => whole(r.missing) },
                { key: "open", label: "", render: (r) => <Chip selected={obj === r.object} onClick={() => setObj(obj === r.object ? null : r.object)}>{t("Items")}</Chip> },
              ]} rows={d.objects} rowKey={(r) => r.object} label={t("Configuration objects")} height={280} />
            </>
          )}
        </Gate>
      </Card>
      {obj !== null ? (
        <Card title={t("Items of {name}", { name: obj })}>
          <Gate q={items} empty={{ heading: t("No items") }}>
            {(d) => d.items.length === 0 ? <EmptyState heading={t("No items.")} body={t("Nothing to show. Choose another filter.")} /> : (
              <DataTable columns={[
                { key: "key", label: t("Key"), render: (r) => <FieldChip code={r.key} description={String(Object.values(r.values).find((v) => typeof v === "string" && v !== r.key) ?? "")} /> },
              ]} rows={d.items} rowKey={(r) => r.key} label={t("Configuration items")} height={280} />
            )}
          </Gate>
        </Card>
      ) : null}
      <ProcessCard />
      <RediscoverCard />
      <Card title={t("Configuration drift")}>
        <Gate q={drift} empty={{ heading: t("No drift to show"), body: t("Drift appears once two runs exist.") }}>
          {(d) => d.drift_entries.length === 0 ? <EmptyState heading={t("No drift between the last two runs.")} body={t("The configuration matches the last run.")} /> : (
            <DataTable columns={[
              { key: "module", label: t("Module"), render: (r) => r.module },
              { key: "element_value", label: t("Element"), render: (r) => <FieldChip code={r.element_value} description={r.element_type} /> },
              { key: "change_type", label: t("Change"), render: (r) => <SeverityPill sev="info" label={r.change_type} /> },
              { key: "current_value", label: t("Now"), render: (r) => r.current_value ?? "-" },
            ]} rows={d.drift_entries} rowKey={(r) => `${r.module}-${r.element_value}-${r.change_type}`} label={t("Configuration drift")} height={260} />
          )}
        </Gate>
      </Card>
    </div>
  );
}
