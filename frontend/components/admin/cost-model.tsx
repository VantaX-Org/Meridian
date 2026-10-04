"use client";

/**
 * Cost model: what one failing record costs, by severity, object or rule.
 * Each row shows the shipped default, the tenant's override and the value
 * that applies. A cost is either a flat amount per record or a SAP field
 * read from the record times a factor (for example EKPO.NETWR × 0.05).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, EmptyState, Field, Input, SectionCard, TableSkeleton } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { getCostModel, putCostModel, type CostModel, type CostSpec } from "@/lib/api/scoring";
import { formatModuleName } from "@/lib/format";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
type Section = "severity" | "modules" | "rules";
type Drafts = Record<Section, Record<string, string>>;

/** "500" → per record; "EKPO.NETWR" or "EKPO.NETWR * 0.05" → field times factor. */
export function parseSpec(text: string): CostSpec | string | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) return { per_record: Number(t) };
  const m = t.match(/^([A-Z0-9_/]+)\.([A-Z0-9_/]+)\s*(?:[*×x]\s*(\d+(?:\.\d+)?))?$/i);
  if (!m) return "Enter an amount, or TABLE.FIELD with an optional × factor.";
  return { field: `${m[1].toUpperCase()}.${m[2].toUpperCase()}`, ...(m[3] ? { factor: Number(m[3]) } : {}) };
}

export function specText(s?: CostSpec | null): string {
  if (!s) return "";
  if (s.field) return s.factor != null && s.factor !== 1 ? `${s.field} × ${s.factor}` : s.field;
  return s.per_record != null ? String(s.per_record) : "";
}

function draftsFrom(tenant?: CostModel): Drafts {
  const pick = (m?: Record<string, CostSpec>) => Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, specText(v)]));
  return { severity: pick(tenant?.severity), modules: pick(tenant?.modules), rules: pick(tenant?.rules) };
}

export function CostModelEditor() {
  const q = useQuery({ queryKey: ["settings.cost-model"], queryFn: getCostModel, retry: false, meta: { ignoreError: true } });
  if (q.isLoading) return <TableSkeleton rows={6} label="Loading cost model" />;
  if (q.error) return <Banner tone="danger" title="Cost model could not be read">{apiErrorMessage(q.error)}</Banner>;
  if (!q.data) {
    return <EmptyState>The cost model is not available on this server. The planner tab holds a single cost per failing record instead.</EmptyState>;
  }
  return <CostForm key={q.dataUpdatedAt} data={q.data} />;
}

function CostForm({ data }: { data: { defaults?: CostModel; tenant?: CostModel; effective?: CostModel } }) {
  const qc = useQueryClient();
  const write = useRole().can("manage_settings");
  const [currency, setCurrency] = useState(data.tenant?.currency ?? "");
  const [drafts, setDrafts] = useState<Drafts>(() => draftsFrom(data.tenant));
  const [newKey, setNewKey] = useState<Record<"modules" | "rules", string>>({ modules: "", rules: "" });
  const cur = currency || data.effective?.currency || data.defaults?.currency || "";

  const parsed = useMemo(() => {
    const out: Record<Section, Record<string, CostSpec>> = { severity: {}, modules: {}, rules: {} };
    const errors: Record<string, string> = {};
    (Object.keys(drafts) as Section[]).forEach((s) => Object.entries(drafts[s]).forEach(([k, v]) => {
      const p = parseSpec(v);
      if (typeof p === "string") errors[`${s}.${k}`] = p; else if (p) out[s][k] = p;
    }));
    return { out, errors };
  }, [drafts]);

  const save = useMutation({
    mutationFn: () => putCostModel({ currency: currency || undefined, ...parsed.out }),
    onSuccess: () => {
      toast.success("Cost model saved. Costs update on the next analysis run.");
      qc.invalidateQueries({ queryKey: ["settings.cost-model"] });
      qc.invalidateQueries({ queryKey: ["findings.aggregate"] });
    },
    onError: (e) => toast.error(`Cost model not saved. ${apiErrorMessage(e)}`),
  });

  const set = (s: Section, k: string, v: string) => setDrafts({ ...drafts, [s]: { ...drafts[s], [k]: v } });
  const drop = (s: Section, k: string) => { const next = { ...drafts[s] }; delete next[k]; setDrafts({ ...drafts, [s]: next }); };
  const show = (s?: CostSpec) => {
    const t = specText(s);
    if (!t) return "—";
    return s?.field ? t : `${cur} ${Number(t).toLocaleString()}`;
  };

  const table = (section: Section, keys: string[], label: (k: string) => string, removable: boolean) => (
    <table className="ui-mini-table">
      <thead><tr><th>{section === "severity" ? "Severity" : section === "modules" ? "Object" : "Check"}</th><th>Default</th><th>Your setting</th><th>Applies</th>
        {removable && write ? <th><span className="ui-visually-hidden">Actions</span></th> : null}</tr></thead>
      <tbody>
        {keys.map((k) => {
          const err = parsed.errors[`${section}.${k}`];
          return (
            <tr key={k}>
              <td className={section === "rules" ? "ui-mono" : undefined}>{label(k)}</td>
              <td>{show(data.defaults?.[section]?.[k])}</td>
              <td style={{ width: 200 }}>
                <Input value={drafts[section][k] ?? ""} disabled={!write} placeholder={specText(data.defaults?.[section]?.[k]) || "Not set"}
                  aria-label={`${label(k)} cost`} invalid={!!err} title={err} onChange={(e) => set(section, k, e.target.value)} />
              </td>
              <td>{show(drafts[section][k] ? (parsed.out[section][k] ?? undefined) : data.effective?.[section]?.[k] ?? data.defaults?.[section]?.[k])}</td>
              {removable && write ? <td><Button size="sm" variant="ghost" onClick={() => drop(section, k)}>Remove</Button></td> : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const keysOf = (s: "modules" | "rules") => Array.from(new Set([...Object.keys(data.defaults?.[s] ?? {}), ...Object.keys(drafts[s])])).sort();
  const addRow = (s: "modules" | "rules") => (
    write ? (
      <form className="ui-form__actions" onSubmit={(e) => {
        e.preventDefault();
        const k = s === "rules" ? newKey[s].trim().toUpperCase() : newKey[s].trim().toLowerCase();
        if (k) { set(s, k, drafts[s][k] ?? ""); setNewKey({ ...newKey, [s]: "" }); }
      }}>
        <Input aria-label={s === "modules" ? "Object key, for example mm_purchasing" : "Check id"} placeholder={s === "modules" ? "Object, for example mm_purchasing" : "Check id"}
          className={s === "rules" ? "ui-mono" : undefined} value={newKey[s]} onChange={(e) => setNewKey({ ...newKey, [s]: e.target.value })} style={{ maxWidth: 260 }} />
        <Button type="submit" size="sm" variant="secondary" disabled={!newKey[s].trim()}>Add override</Button>
      </form>
    ) : null
  );
  const errorCount = Object.keys(parsed.errors).length;

  return (
    <div className="ui-stack">
      <p className="ui-note">Cost at risk is the number of failing records times their cost. The most specific setting wins: a rule beats its object, an object beats its severity. Enter an amount per record, or <span className="ui-mono">TABLE.FIELD × factor</span> to read the value from the record.</p>
      <SectionCard title="By severity" action={
        <Field label="Currency">
          {({ controlId }) => <Input id={controlId} value={currency} maxLength={3} disabled={!write} placeholder={data.defaults?.currency ?? "ZAR"}
            style={{ width: 80 }} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />}
        </Field>
      }>
        {table("severity", [...SEVERITIES], (k) => k.charAt(0).toUpperCase() + k.slice(1), false)}
      </SectionCard>
      <div className="ui-columns">
        <SectionCard title="By object" meta="Overrides severity">
          <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
            {keysOf("modules").length ? table("modules", keysOf("modules"), formatModuleName, true) : <p className="ui-note">No object overrides.</p>}
            {addRow("modules")}
          </div>
        </SectionCard>
        <SectionCard title="By rule" meta="Overrides object and severity">
          <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
            {keysOf("rules").length ? table("rules", keysOf("rules"), (k) => k, true) : <p className="ui-note">No rule overrides.</p>}
            {addRow("rules")}
          </div>
        </SectionCard>
      </div>
      {write ? (
        <div className="ui-form__actions">
          <Button onClick={() => save.mutate()} disabled={save.isPending || errorCount > 0}>Save cost model</Button>
          <Button variant="ghost" onClick={() => { setDrafts({ severity: {}, modules: {}, rules: {} }); setCurrency(""); }}>Clear my overrides</Button>
          {errorCount ? <span className="ui-micro" role="alert">{errorCount} value{errorCount === 1 ? "" : "s"} to fix. Hover a red field for the reason.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
