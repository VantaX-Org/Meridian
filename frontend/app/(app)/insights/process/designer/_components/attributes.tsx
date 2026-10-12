"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Checkbox, Drawer, Field, Input, Mono, Pill, type PillTone } from "@/design";
import type { ReactNode } from "react";
import { getDdicFields } from "@/lib/api/rules";
import { formatModuleName } from "@/lib/format";
import type { ActivityOverlay, Classification, FieldRef, L4, ProcessVariant } from "@/types/process-model";
import { allL4, findActivity, l1Of, locate, type Doc } from "./doc";

const CLASS_LABEL: Record<Classification, string> = {
  implemented: "Implemented", dormant: "Dormant", configured_not_used: "Configured, not used", customer_specific: "Customer-specific",
};
const DQ: Record<ActivityOverlay["dq_status"], { tone: PillTone; label: string }> = {
  green: { tone: "go", label: "Passing" }, amber: { tone: "at-risk", label: "Some fields failing" }, red: { tone: "no-go", label: "Blocking failures" },
};
const FIELD = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;

const note = { color: "var(--m-ink-2)" } as const;
const Note = ({ children }: { children: ReactNode }) => <p className="m-text-meta" style={note}>{children}</p>;
const Heading = ({ children }: { children: ReactNode }) => <h3 className="m-text-h font-semibold" style={{ color: "var(--m-ink)" }}>{children}</h3>;
const Ranked = ({ children }: { children: ReactNode }) => <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>{children}</ul>;
const Item = ({ title, num, meta, children }: { title: ReactNode; num?: ReactNode; meta?: ReactNode; children?: ReactNode }) => (
  <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
    <div className="flex flex-1 min-w-0 flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2 m-text-body" style={{ color: "var(--m-ink)" }}>{title}{num}</div>
      {meta ? <div className="m-text-meta" style={note}>{meta}</div> : null}
    </div>
    {children}
  </li>
);
const linkCls = "underline m-text-body";
const linkStyle = { color: "var(--m-accent-ink)" } as const;

function FieldChip({ table, field }: { table: string; field: string }) {
  return <Pill>{`${table}.${field}`}</Pill>;
}

export interface AttributeProps {
  doc: Doc;
  attr: string | null;
  editable: boolean;
  onBlocked: () => void;
  /** False when the user lacks `analyse` (wave 16): mutating controls are not rendered. */
  canDesign?: boolean;
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
    <Drawer open={!!(hit || l4 || diag)} onOpenChange={(o) => { if (!o) p.onClose(); }} title={title}>
      <div className="flex flex-col gap-3">
        {hit ? <Activity {...p} hit={hit} /> : null}
        {l4 ? <SubProcess {...p} l4={l4} /> : null}
        {diag?.node && diag.node.type !== "task" ? (
          <Field label="Label">
            <Input key={diag.node.id} defaultValue={diag.node.label ?? ""} disabled={!p.editable}
              onBlur={(e) => e.target.value !== (diag.node!.label ?? "") && p.patchNode(diag.x.id, diag.node!.id, e.target.value)} />
          </Field>
        ) : null}
        {diag?.flow ? (
          <>
            <Field label="Label">
              <Input key={`${diag.flow.id}l`} defaultValue={diag.flow.label ?? ""} disabled={!p.editable}
                onBlur={(e) => e.target.value !== (diag.flow!.label ?? "") && p.patchFlow(diag.x.id, diag.flow!.id, { label: e.target.value || null })} />
            </Field>
            <Field label="Condition">
              <Input key={`${diag.flow.id}c`} defaultValue={diag.flow.condition ?? ""} disabled={!p.editable}
                onBlur={(e) => e.target.value !== (diag.flow!.condition ?? "") && p.patchFlow(diag.x.id, diag.flow!.id, { condition: e.target.value || null })} />
            </Field>
          </>
        ) : null}
      </div>
    </Drawer>
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
      <Field label="Name">
        <Input key={act.id} defaultValue={act.name} disabled={!p.editable}
          onBlur={(e) => e.target.value.trim() && e.target.value !== act.name && p.patchActivity(act.id, { name: e.target.value.trim() })} />
      </Field>
      <Field label="Description">
        <textarea key={`${act.id}d`} rows={3} defaultValue={act.description} disabled={!p.editable}
          className="m-input w-full" style={{ height: "auto", padding: "var(--m-space-2) var(--m-space-3)" }}
          onBlur={(e) => e.target.value !== act.description && p.patchActivity(act.id, { description: e.target.value })} />
      </Field>
      <Field label="T-code">
        <Input key={`${act.id}t`} defaultValue={act.tcode ?? ""} disabled={!p.editable}
          onBlur={(e) => e.target.value !== (act.tcode ?? "") && p.patchActivity(act.id, { tcode: e.target.value.trim().toUpperCase() || null })} />
      </Field>
      {act.evidence === "not_extracted" ? <Note>No document table extracted for this step.</Note> : null}
      {dq ? (
        <Note>
          <Pill tone={DQ[dq.dq_status].tone}>{DQ[dq.dq_status].label}</Pill>{" "}
          {dq.finding_count.toLocaleString()} {dq.finding_count === 1 ? "check has" : "checks have"} findings, {dq.affected_count.toLocaleString()} records affected.
        </Note>
      ) : null}
      <section aria-label="Fields">
        <Heading>Fields</Heading>
        <Ranked>
          {act.fields.map((f) => {
            const [table, col] = f.field.split(".");
            const finding = f.check_id ? link(f.check_id) : undefined;
            return (
              <Item key={f.field} title={<FieldChip table={table} field={col} />}
                num={f.check_id ? <Link className={linkCls} style={linkStyle} href={`/analyse/rule/${f.check_id}`}><Mono>{f.check_id}</Mono></Link> : null}
                meta={<>
                  {f.description}{f.config_source ? <>{" "}Config source <Mono>{f.config_source}</Mono>.</> : null}
                  {finding ? <>{" "}<Link className="underline" style={linkStyle} href={finding}>Open finding</Link></> : null}
                </>}>
                {p.canDesign === false ? (
                  <span className="m-text-meta" style={note}>{f.mandatory ? "Mandatory" : "Optional"}</span>
                ) : (
                  <span className="inline-flex items-center gap-2 m-text-meta" style={note}>
                    <Checkbox aria-label={`Mandatory ${f.field}`} checked={f.mandatory} disabled={!p.editable}
                      onChange={(e) => set(act.fields.map((x) => (x === f ? { ...x, mandatory: e.target.checked } : x)))} /> Mandatory
                  </span>
                )}
                {p.canDesign !== false ? <Button variant="ghost" disabled={!p.editable} aria-label={`Remove ${f.field}`}
                  onClick={() => set(act.fields.filter((x) => x !== f))}>Remove</Button> : null}
              </Item>
            );
          })}
        </Ranked>
        {p.editable ? (
          <form className="flex flex-col gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <Field label="Add field" error={error ?? undefined}>
              <Input value={row.field} placeholder="Table name, a dot, then the field name." onChange={(e) => setRow({ ...row, field: e.target.value })} />
            </Field>
            <Field label="Rule">
              <Input value={row.check} onChange={(e) => setRow({ ...row, check: e.target.value })} />
            </Field>
            <Button variant="secondary" type="submit">Add field</Button>
          </form>
        ) : p.canDesign === false ? null : <Note><Button variant="ghost" onClick={p.onBlocked}>Create a model to edit fields</Button></Note>}
      </section>
    </>
  );
}

function SubProcess(p: AttributeProps & { l4: L4 }) {
  const { l4 } = p;
  const tables = new Set(l4.activities.flatMap((a) => a.sap_tables));
  const candidates = p.unmapped.filter((v) => tables.has(v.sap_table)).slice(0, 12);
  const text = (label: string, key: "name" | "tcode" | "config_dependency") => (
    <Field label={label}>
      <Input key={`${l4.id}${key}`} defaultValue={l4[key] ?? ""} disabled={!p.editable}
        onBlur={(e) => e.target.value !== (l4[key] ?? "") && p.patchL4(l4.id, { [key]: key === "name" ? e.target.value.trim() || l4.name : e.target.value.trim() || null })} />
    </Field>
  );
  return (
    <>
      {text("Name", "name")}
      {text("T-code", "tcode")}
      {text("Config dependency", "config_dependency")}
      <section aria-label="Variants">
        <Heading>Variants</Heading>
        {l4.variants.length ? (
          <Ranked>
            {l4.variants.map((v) => (
              <Item key={`${v.sap_table}.${v.sap_field}.${v.value}`}
                title={<><FieldChip table={v.sap_table} field={v.sap_field} /> <Mono>{v.value}</Mono></>}
                num={<Pill>{CLASS_LABEL[v.classification]}</Pill>} />
            ))}
          </Ranked>
        ) : <Note>No variants are attached to this sub-process.</Note>}
      </section>
      {candidates.length && p.canDesign !== false ? (
        <section aria-label="Unmapped variants">
          <Heading>Unmapped variants on its tables</Heading>
          {!p.canAdopt ? <Note>Save the model, and open a saved model, to adopt a variant.</Note> : null}
          <Ranked>
            {candidates.map((v) => (
              <Item key={v.id ?? `${v.sap_table}${v.sap_field}${v.value}`}
                title={<><FieldChip table={v.sap_table} field={v.sap_field} /> <Mono>{v.value}</Mono></>}
                num={<Pill>{CLASS_LABEL[v.classification]}</Pill>}>
                <Button variant="secondary" disabled={!p.canAdopt || !v.id} onClick={() => v.id && p.onAdopt(v.id, l4.id)}>Adopt</Button>
              </Item>
            ))}
          </Ranked>
        </section>
      ) : null}
      <Note>Modules: {l1Of(p.doc, l4.id)?.modules.map(formatModuleName).join(", ") || "none"}.</Note>
    </>
  );
}
