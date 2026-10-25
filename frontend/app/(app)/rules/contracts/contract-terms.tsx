"use client";

/**
 * A data contract's terms: read as label and value pairs, and edited on a draft. The shapes are the ones
 * api/services/contract_compliance.py evaluates:
 *   quality_contract    {"min_dqs": 80, "completeness": 95, ...}   percentages
 *   volume_contract     {"min_records": 100, "max_records": 10000}
 *   freshness_contract  {"max_age_hours": 24}
 *   schema_contract     {"FIELD": {"mandatory": true, "allowed_values": [...]}, ...}
 * and an optional "modules" scope in any section, which the editor keeps as it is.
 */

import { useState, type ReactNode } from "react";
import { Button, Card, Checkbox, Field, Input, Mono } from "@/design";
import { formatModuleName } from "@/lib/format";
import type { Contract } from "@/types/api";

export type TermSection = "schema_contract" | "quality_contract" | "freshness_contract" | "volume_contract";
export type TermsBody = Record<TermSection, Record<string, unknown>>;

const SECTIONS: [TermSection, string][] = [["quality_contract", "Quality"], ["freshness_contract", "Freshness"], ["volume_contract", "Volume"], ["schema_contract", "Schema"]];

const QUALITY: [string, string][] = [
  ["min_dqs", "Minimum DQS"], ["completeness", "Completeness"], ["accuracy", "Accuracy"], ["consistency", "Consistency"],
  ["timeliness", "Timeliness"], ["uniqueness", "Uniqueness"], ["validity", "Validity"],
];
const LABELS: Record<string, string> = {
  ...Object.fromEntries(QUALITY), max_age_hours: "Maximum age", min_records: "Minimum records", max_records: "Maximum records", modules: "Objects",
};

const sectionOf = (c: Contract, k: TermSection): Record<string, unknown> => (c[k] ?? {}) as Record<string, unknown>;

/** A key that states a term; the "modules" scope alone promises nothing. */
const termKeys = (section: Record<string, unknown>) => Object.keys(section).filter((k) => k !== "modules");

export const hasTerms = (c: Contract): boolean => SECTIONS.some(([k]) => termKeys(sectionOf(c, k)).length > 0);

const humanise = (key: string) => { const s = key.replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };

/** A value as words, never as JSON. */
function describe(v: unknown): string {
  if (v == null) return "None";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  if (Array.isArray(v)) return v.map(describe).join(", ");
  if (typeof v === "object") return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${humanise(k)} ${describe(x)}`).join(", ");
  return String(v);
}

function valueOf(section: TermSection, key: string, v: unknown): ReactNode {
  if (key === "modules" && Array.isArray(v)) return v.map((m) => formatModuleName(String(m))).join(", ");
  if (section === "quality_contract" && typeof v === "number") return key === "min_dqs" ? `At least ${v}` : `At least ${v}%`;
  if (key === "max_age_hours" && typeof v === "number") return `${v.toLocaleString()} ${v === 1 ? "hour" : "hours"}`;
  if (section === "schema_contract" && v && typeof v === "object" && !Array.isArray(v)) {
    const r = v as { mandatory?: unknown; allowed_values?: unknown };
    const allowed = Array.isArray(r.allowed_values) ? r.allowed_values.map(String) : [];
    return (
      <>
        {r.mandatory ? "Mandatory" : "Optional"}
        {allowed.length ? <>, allowed {allowed.map((a, i) => <span key={a}>{i ? ", " : ""}<Mono>{a}</Mono></span>)}</> : null}
      </>
    );
  }
  return describe(v);
}

/** The stated terms, one card per section, as label and value pairs. */
export function ContractTermsView({ contract: c }: { contract: Contract }) {
  const shown = SECTIONS.filter(([k]) => Object.keys(sectionOf(c, k)).length > 0);
  if (!shown.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {shown.map(([k, title]) => (
        <div key={k}>
          <Card title={`${title} terms`} padding="sm">
            <dl className="m-text-body grid grid-cols-[140px_1fr] gap-y-1">
              {Object.entries(sectionOf(c, k)).map(([key, v]) => (
                <div key={key} className="contents">
                  {/* a schema term is keyed by its SAP field name */}
                  <dt className="m-ink-3">{k === "schema_contract" && key !== "modules" ? <Mono>{key}</Mono> : LABELS[key] ?? humanise(key)}</dt>
                  <dd>{valueOf(k, key, v)}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      ))}
    </div>
  );
}

interface SchemaRow { field: string; mandatory: boolean; allowed: string }
interface TermsDraft {
  quality: Record<string, string>;
  max_age_hours: string;
  min_records: string;
  max_records: string;
  schema: SchemaRow[];
}

const str = (v: unknown) => (typeof v === "number" ? String(v) : "");

function draftOf(c: Contract): TermsDraft {
  const q = sectionOf(c, "quality_contract");
  const f = sectionOf(c, "freshness_contract");
  const v = sectionOf(c, "volume_contract");
  const s = sectionOf(c, "schema_contract");
  return {
    quality: Object.fromEntries(QUALITY.map(([k]) => [k, str(q[k])])),
    max_age_hours: str(f.max_age_hours),
    min_records: str(v.min_records),
    max_records: str(v.max_records),
    schema: Object.entries(s).filter(([k, r]) => k !== "modules" && r && typeof r === "object" && !Array.isArray(r)).map(([field, r]) => {
      const rule = r as { mandatory?: unknown; allowed_values?: unknown };
      return { field, mandatory: !!rule.mandatory, allowed: Array.isArray(rule.allowed_values) ? rule.allowed_values.map(String).join(", ") : "" };
    }),
  };
}

const num = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** Problems with a draft, by input; an empty object means it can be saved. */
export function termErrors(d: TermsDraft): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, label] of QUALITY) {
    const n = num(d.quality[k] ?? "");
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) e[k] = `${label} is a percentage from 0 to 100`;
  }
  const age = num(d.max_age_hours);
  if (age !== null && (!Number.isFinite(age) || age <= 0)) e.max_age_hours = "Enter a number of hours above 0";
  const min = num(d.min_records);
  const max = num(d.max_records);
  if (min !== null && (!Number.isInteger(min) || min < 0)) e.min_records = "Enter a whole number of records";
  if (max !== null && (!Number.isInteger(max) || max < 0)) e.max_records = "Enter a whole number of records";
  if (!e.min_records && !e.max_records && min !== null && max !== null && min > max) e.max_records = "The maximum is below the minimum";
  const fields = d.schema.map((r) => r.field.trim().toUpperCase()).filter(Boolean);
  if (new Set(fields).size !== fields.length) e.schema = "Name each field once";
  if (d.schema.some((r) => !r.field.trim() && (r.mandatory || r.allowed.trim()))) e.schema = "Name the field of every schema term";
  return e;
}

/** The four sections to send: edited keys replaced, cleared keys dropped, every other key (the scope) kept. */
export function termsBody(c: Contract, d: TermsDraft): TermsBody {
  const q: Record<string, unknown> = { ...sectionOf(c, "quality_contract") };
  for (const [k] of QUALITY) { const n = num(d.quality[k] ?? ""); if (n === null) delete q[k]; else q[k] = n; }
  const f: Record<string, unknown> = { ...sectionOf(c, "freshness_contract") };
  const age = num(d.max_age_hours);
  if (age === null) delete f.max_age_hours; else f.max_age_hours = age;
  const v: Record<string, unknown> = { ...sectionOf(c, "volume_contract") };
  for (const k of ["min_records", "max_records"] as const) { const n = num(d[k]); if (n === null) delete v[k]; else v[k] = n; }
  const old = sectionOf(c, "schema_contract");
  const s: Record<string, unknown> = "modules" in old ? { modules: old.modules } : {};
  for (const r of d.schema) {
    const field = r.field.trim().toUpperCase();
    if (!field) continue;
    const allowed = r.allowed.split(",").map((a) => a.trim()).filter(Boolean);
    s[field] = { mandatory: r.mandatory, ...(allowed.length ? { allowed_values: allowed } : {}) };
  }
  return { quality_contract: q, freshness_contract: f, volume_contract: v, schema_contract: s };
}

/** The terms of a draft as inputs. Blank leaves a term out. */
export function ContractTermsEditor({ contract, pending, onSave, onCancel }: { contract: Contract; pending: boolean; onSave: (body: TermsBody) => void; onCancel: () => void }) {
  const [d, setD] = useState<TermsDraft>(() => draftOf(contract));
  const errors = termErrors(d);
  const valid = Object.keys(errors).length === 0;
  const setRow = (i: number, patch: Partial<SchemaRow>) => setD({ ...d, schema: d.schema.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <form noValidate className="flex flex-col gap-4" aria-label="Contract terms" onSubmit={(e) => { e.preventDefault(); if (valid) onSave(termsBody(contract, d)); }}>
      <fieldset className="flex flex-col gap-2">
        <legend className="m-text-body font-semibold mb-1">Quality, the lowest score accepted</legend>
        <div className="grid grid-cols-2 gap-3">
          {QUALITY.map(([k, label]) => (
            <Field key={k} label={k === "min_dqs" ? label : `${label} %`} error={errors[k]}>
              <Input type="number" inputMode="decimal" min={0} max={100} value={d.quality[k] ?? ""} onChange={(e) => setD({ ...d, quality: { ...d.quality, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="m-text-body font-semibold mb-1">Freshness</legend>
        <Field label="Maximum age of the latest analysis, in hours" error={errors.max_age_hours}>
          <Input type="number" inputMode="decimal" min={0} value={d.max_age_hours} onChange={(e) => setD({ ...d, max_age_hours: e.target.value })} />
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="m-text-body font-semibold mb-1">Volume, records per analysis</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Minimum records" error={errors.min_records}>
            <Input type="number" inputMode="numeric" min={0} step={1} value={d.min_records} onChange={(e) => setD({ ...d, min_records: e.target.value })} />
          </Field>
          <Field label="Maximum records" error={errors.max_records}>
            <Input type="number" inputMode="numeric" min={0} step={1} value={d.max_records} onChange={(e) => setD({ ...d, max_records: e.target.value })} />
          </Field>
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="m-text-body font-semibold mb-1">Schema, checked on golden records</legend>
        {d.schema.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
            <Field label="SAP field">
              <Input value={r.field} onChange={(e) => setRow(i, { field: e.target.value })} placeholder="LIFNR" />
            </Field>
            <label className="flex items-center gap-2 m-text-body pb-2">
              <Checkbox aria-label={`${r.field || "Field"} is mandatory`} checked={r.mandatory} onChange={(e) => setRow(i, { mandatory: e.target.checked })} />
              Mandatory
            </label>
            <Field label="Allowed values, comma separated">
              <Input value={r.allowed} onChange={(e) => setRow(i, { allowed: e.target.value })} />
            </Field>
            <Button type="button" variant="ghost" onClick={() => setD({ ...d, schema: d.schema.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
        {errors.schema ? <p className="m-field-error" role="alert">{errors.schema}</p> : null}
        <div><Button type="button" variant="secondary" onClick={() => setD({ ...d, schema: [...d.schema, { field: "", mandatory: true, allowed: "" }] })}>Add a field</Button></div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" pending={pending} disabled={!valid}>Save terms</Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>Discard changes</Button>
      </div>
    </form>
  );
}
