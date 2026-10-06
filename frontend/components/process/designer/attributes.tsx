"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Chip, DetailDrawer, Field, FieldChip, Input, Mono, StatusBadge, Textarea, type Status } from "@/components/ui-core";
import { getDdicFields } from "@/lib/api/rules";
import { formatModuleName } from "@/lib/format";
import type { ActivityOverlay, Classification, FieldRef, L4, ProcessVariant } from "@/types/process-model";
import { allL4, findActivity, l1Of, locate, type Doc } from "./doc";

const CLASS_LABEL: Record<Classification, string> = {
  implemented: "Implemented", dormant: "Dormant", configured_not_used: "Configured, not used", customer_specific: "Customer-specific",
};
const DQ: Record<ActivityOverlay["dq_status"], { status: Status; label: string }> = {
  green: { status: "ok", label: "Passing" }, amber: { status: "medium", label: "Some fields failing" }, red: { status: "critical", label: "Blocking failures" },
};
const FIELD = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;

export interface AttributeProps {
  doc: Doc;
  attr: string | null;
  editable: boolean;
  onBlocked: () => void;
  onClose: () => void;
  overlay: Record<string, ActivityOverlay> | null;
  unmapped: ProcessVariant[];
  canAdopt: boolean;
  onAdopt: (variantId: string, l4Id: string) => void;
  findingHref: (module: string, checkId: string) => string | undefined;
  patchActivity: (id: string, patch: Partial<{ name: string; description: string; tcode: string | null; fields: FieldRef[] }>) => void;
  patchL4: (id: string, patch: Partial<Pick<L4, "name" | "tcode" | "config_dependency" | "description">>) => void;
  patchNode: (l4Id: string, nodeId: string, label: string) => void;
  patchFlow: (l4Id: string, flowId: string, patch: { label?: string | null; condition?: string | null }) => void;
}

export function AttributeDrawer(p: AttributeProps) {
  const { doc, attr } = p;
  const hit = attr ? findActivity(doc, attr) : null;
  const l4 = !hit && attr ? (locate(doc, attr)?.level === 4 ? (locate(doc, attr)!.item as L4) : null) : null;
  const diag = !hit && !l4 && attr
    ? allL4(doc).map((x) => ({ x, node: x.diagram.nodes.find((n) => n.id === attr), flow: x.diagram.flows.find((f) => f.id === attr) })).find((h) => h.node || h.flow)
    : undefined;
  const title = hit?.act.name ?? l4?.name ?? (diag?.flow ? "Flow" : diag?.node ? "Decision" : "Details");
  return (
    <DetailDrawer open={!!(hit || l4 || diag)} onClose={p.onClose} ariaLabel={title}
      header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">{title}</h2></div>}>
      <div className="ui-detail">
        {hit ? <Activity {...p} hit={hit} /> : null}
        {l4 ? <SubProcess {...p} l4={l4} /> : null}
        {diag?.node && diag.node.type !== "task" ? (
          <Field label="Label">{({ controlId }) => (
            <Input id={controlId} key={diag.node!.id} defaultValue={diag.node!.label ?? ""} disabled={!p.editable}
              onBlur={(e) => e.target.value !== (diag.node!.label ?? "") && p.patchNode(diag.x.id, diag.node!.id, e.target.value)} />
          )}</Field>
        ) : null}
        {diag?.flow ? (
          <>
            <Field label="Label">{({ controlId }) => (
              <Input id={controlId} key={`${diag.flow!.id}l`} defaultValue={diag.flow!.label ?? ""} disabled={!p.editable}
                onBlur={(e) => e.target.value !== (diag.flow!.label ?? "") && p.patchFlow(diag.x.id, diag.flow!.id, { label: e.target.value || null })} />
            )}</Field>
            <Field label="Condition">{({ controlId }) => (
              <Input id={controlId} key={`${diag.flow!.id}c`} defaultValue={diag.flow!.condition ?? ""} disabled={!p.editable}
                onBlur={(e) => e.target.value !== (diag.flow!.condition ?? "") && p.patchFlow(diag.x.id, diag.flow!.id, { condition: e.target.value || null })} />
            )}</Field>
          </>
        ) : null}
      </div>
    </DetailDrawer>
  );
}

function Activity(p: AttributeProps & { hit: NonNullable<ReturnType<typeof findActivity>> }) {
  const { act, l1 } = p.hit;
  const dq = p.overlay?.[act.id];
  const [row, setRow] = useState({ field: "", check: "" });
  const [error, setError] = useState<string | null>(null);
  const set = (fields: FieldRef[]) => p.patchActivity(act.id, { fields });
  const add = async () => {
    const field = row.field.trim().toUpperCase();
    if (!FIELD.test(field)) return setError("Use the form TABLE.FIELD.");
    if (act.fields.some((f) => f.field === field)) return setError("This field is already on the activity.");
    try {
      const [d] = await getDdicFields([field]);
      if (!d || d.missing) return setError("This field is not in the SAP dictionary.");
      set([...act.fields, { field, check_id: row.check.trim().toUpperCase() || null, description: d.description ?? "", mandatory: false, config_source: null }]);
      setRow({ field: "", check: "" });
      setError(null);
    } catch {
      setError("The dictionary did not answer. Try again.");
    }
  };
  const link = (check: string) => l1.modules.map((m) => p.findingHref(m, check)).find(Boolean);
  return (
    <>
      <Field label="Name">{({ controlId }) => (
        <Input id={controlId} key={act.id} defaultValue={act.name} disabled={!p.editable}
          onBlur={(e) => e.target.value.trim() && e.target.value !== act.name && p.patchActivity(act.id, { name: e.target.value.trim() })} />
      )}</Field>
      <Field label="Description">{({ controlId }) => (
        <Textarea id={controlId} key={`${act.id}d`} rows={3} defaultValue={act.description} disabled={!p.editable}
          onBlur={(e) => e.target.value !== act.description && p.patchActivity(act.id, { description: e.target.value })} />
      )}</Field>
      <Field label="T-code">{({ controlId }) => (
        <Input id={controlId} key={`${act.id}t`} defaultValue={act.tcode ?? ""} disabled={!p.editable}
          onBlur={(e) => e.target.value !== (act.tcode ?? "") && p.patchActivity(act.id, { tcode: e.target.value.trim().toUpperCase() || null })} />
      )}</Field>
      {act.evidence === "not_extracted" ? <p className="ui-note">No document table extracted for this step.</p> : null}
      {dq ? (
        <p className="ui-note">
          <StatusBadge status={DQ[dq.dq_status].status}>{DQ[dq.dq_status].label}</StatusBadge>{" "}
          {dq.finding_count.toLocaleString()} {dq.finding_count === 1 ? "check has" : "checks have"} findings, {dq.affected_count.toLocaleString()} records affected.
        </p>
      ) : null}
      <section aria-label="Fields">
        <h3 className="ui-drawer-head__title">Fields</h3>
        <ul className="ui-ranked">
          {act.fields.map((f) => {
            const [table, col] = f.field.split(".");
            const finding = f.check_id ? link(f.check_id) : undefined;
            return (
              <li key={f.field}>
                <div className="ui-ranked__row">
                  <span className="ui-ranked__title"><FieldChip table={table} field={col} /></span>
                  <span className="ui-ranked__num">
                    {f.check_id ? <Link className="ui-link" href={`/analyse/rule/${f.check_id}`}><Mono>{f.check_id}</Mono></Link> : null}
                  </span>
                  <span className="ui-ranked__meta">
                    {f.description}{f.config_source ? <>{" "}Config source <Mono>{f.config_source}</Mono>.</> : null}
                    {finding ? <>{" "}<Link className="ui-link" href={finding}>Open finding</Link></> : null}
                  </span>
                </div>
                <label className="ui-note">
                  <input type="checkbox" checked={f.mandatory} disabled={!p.editable}
                    onChange={(e) => set(act.fields.map((x) => (x === f ? { ...x, mandatory: e.target.checked } : x)))} /> Mandatory
                </label>
                <Button size="sm" variant="ghost" disabled={!p.editable} aria-label={`Remove ${f.field}`}
                  onClick={() => set(act.fields.filter((x) => x !== f))}>Remove</Button>
              </li>
            );
          })}
        </ul>
        {p.editable ? (
          <form className="aurora-designer__addrow" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <Field label="Add field" helper="Table name, a dot, then the field name." error={error ?? undefined}>{({ controlId }) => (
              <Input id={controlId} value={row.field} onChange={(e) => setRow({ ...row, field: e.target.value })} invalid={!!error} />
            )}</Field>
            <Field label="Rule">{({ controlId }) => (
              <Input id={controlId} value={row.check} onChange={(e) => setRow({ ...row, check: e.target.value })} />
            )}</Field>
            <Button size="sm" variant="secondary" type="submit">Add field</Button>
          </form>
        ) : <p className="ui-note"><button type="button" className="ui-link-button" onClick={p.onBlocked}>Create a model to edit fields.</button></p>}
      </section>
    </>
  );
}

function SubProcess(p: AttributeProps & { l4: L4 }) {
  const { l4 } = p;
  const tables = new Set(l4.activities.flatMap((a) => a.sap_tables));
  const candidates = p.unmapped.filter((v) => tables.has(v.sap_table)).slice(0, 12);
  const text = (label: string, key: "name" | "tcode" | "config_dependency") => (
    <Field label={label}>{({ controlId }) => (
      <Input id={controlId} key={`${l4.id}${key}`} defaultValue={l4[key] ?? ""} disabled={!p.editable}
        onBlur={(e) => e.target.value !== (l4[key] ?? "") && p.patchL4(l4.id, { [key]: key === "name" ? e.target.value.trim() || l4.name : e.target.value.trim() || null })} />
    )}</Field>
  );
  return (
    <>
      {text("Name", "name")}
      {text("T-code", "tcode")}
      {text("Config dependency", "config_dependency")}
      <section aria-label="Variants">
        <h3 className="ui-drawer-head__title">Variants</h3>
        {l4.variants.length ? (
          <ul className="ui-ranked">
            {l4.variants.map((v) => (
              <li key={`${v.sap_table}.${v.sap_field}.${v.value}`}>
                <div className="ui-ranked__row">
                  <span className="ui-ranked__title"><FieldChip table={v.sap_table} field={v.sap_field} /> <Mono>{v.value}</Mono></span>
                  <span className="ui-ranked__num"><Chip>{CLASS_LABEL[v.classification]}</Chip></span>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="ui-note">No variants are attached to this sub-process.</p>}
      </section>
      {candidates.length ? (
        <section aria-label="Unmapped variants">
          <h3 className="ui-drawer-head__title">Unmapped variants on its tables</h3>
          {!p.canAdopt ? <p className="ui-note">Save the model, and open a saved model, to adopt a variant.</p> : null}
          <ul className="ui-ranked">
            {candidates.map((v) => (
              <li key={v.id ?? `${v.sap_table}${v.sap_field}${v.value}`}>
                <div className="ui-ranked__row">
                  <span className="ui-ranked__title"><FieldChip table={v.sap_table} field={v.sap_field} /> <Mono>{v.value}</Mono></span>
                  <span className="ui-ranked__num"><Chip>{CLASS_LABEL[v.classification]}</Chip></span>
                </div>
                <Button size="sm" variant="secondary" disabled={!p.canAdopt || !v.id} onClick={() => v.id && p.onAdopt(v.id, l4.id)}>Adopt</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="ui-note">Modules: {l1Of(p.doc, l4.id)?.modules.map(formatModuleName).join(", ") || "none"}.</p>
    </>
  );
}
