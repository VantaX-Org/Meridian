/**
 * The fixture contract: fixture mode must answer in the shapes the API answers in, and name only rules the engine has.
 *
 * 1. Every GET route of the API that declares its response (openapi.json, generated from the FastAPI app with
 *    `PYTHONPATH=$PWD python -c "import json; from api.main import app; print(json.dumps(app.openapi()))"
 *    > frontend/lib/api/v2/fixtures/openapi.json` from the repository root) is asked of the fixtures with the demo
 *    tenant's ids; each answer the fixtures give is validated against the declared schema: types, required fields,
 *    enums, and no field the API does not send.
 * 2. Every rule the fixtures show (the library, an object's failing rules, the capping rules of each receipt and of
 *    each landscape cell) is a rule of checks/rules with the same message, field, severity, dimension and class, and
 *    the counts agree: rules measured per cell, per receipt and in the status strip, and the rules library.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";
import { fixtureResponse } from "./index";
import { LIBRARY } from "./library";
import type { Landscape, Receipt, RuleRow } from "../types";

type Schema = {
  $ref?: string;
  type?: string | string[];
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  format?: string;
};
interface OpenApi {
  paths: Record<string, Record<string, { parameters?: { name: string; in: string; required?: boolean }[]; responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }>>;
  components: { schemas: Record<string, Schema> };
}

const HERE = __dirname;
const api = JSON.parse(readFileSync(join(HERE, "openapi.json"), "utf8")) as OpenApi;

function resolve(s: Schema): Schema {
  let out = s;
  while (out.$ref) out = api.components.schemas[out.$ref.replace("#/components/schemas/", "")];
  return out;
}

/** The problems of `value` against `schema`, as "path: what" lines; empty when it conforms. */
export function validate(schema: Schema, value: unknown, at = "$"): string[] {
  const s = resolve(schema);
  const alts = s.anyOf ?? s.oneOf;
  if (alts) {
    const tries = alts.map((a) => validate(a, value, at));
    return tries.some((x) => x.length === 0) ? [] : tries.sort((a, b) => a.length - b.length)[0];
  }
  if (s.allOf) return s.allOf.flatMap((a) => validate(a, value, at));
  if ("const" in s && value !== s.const) return [`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(s.const)}`];
  if (s.enum && !s.enum.includes(value)) return [`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.enum)}`];
  const types = s.type == null ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (types.length) {
    const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const ok = types.some((t) => t === kind || (t === "integer" && typeof value === "number" && Number.isInteger(value)) || (t === "number" && typeof value === "number"));
    if (!ok) return [`${at}: ${kind} where the API sends ${types.join(" or ")}`];
  }
  const errs: string[] = [];
  if (typeof value === "string" && s.format === "date-time" && Number.isNaN(Date.parse(value))) errs.push(`${at}: "${value}" is not a date and time`);
  if (typeof value === "string" && s.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errs.push(`${at}: "${value}" is not a date`);
  if (Array.isArray(value) && s.items) value.forEach((v, i) => errs.push(...validate(s.items as Schema, v, `${at}[${i}]`)));
  if (value && typeof value === "object" && !Array.isArray(value) && (s.properties || s.additionalProperties !== undefined)) {
    const obj = value as Record<string, unknown>;
    for (const k of s.required ?? []) if (!(k in obj)) errs.push(`${at}.${k}: missing`);
    for (const [k, v] of Object.entries(obj)) {
      const p = s.properties?.[k];
      if (p) errs.push(...validate(p, v, `${at}.${k}`));
      else if (s.additionalProperties && typeof s.additionalProperties === "object") errs.push(...validate(s.additionalProperties, v, `${at}.${k}`));
      else if (s.properties && s.additionalProperties !== true && !s.additionalProperties) errs.push(`${at}.${k}: the API does not send this field`);
    }
  }
  return errs;
}

/** The demo tenant's ids, for the path parameters of the API's routes. */
const L = fixtureResponse<Landscape>("/landscape", {});
const IDS: Record<string, string> = {
  module: "material_master",
  object: "material_master",
  system_id: L.systems[0].id,
  version_id: L.cells[0].run_id,
  run_id: L.cells[0].run_id,
  a: "",
  b: L.cells[0].run_id,
  check_id: "MM142",
  record_key: "MATNR=000000000000000232",
  key: "MATNR=000000000000000232",
  matnr: "000000000000000232",
};

/** Values for the required query parameters of a route. */
const QUERY: Record<string, string> = { target_kind: "object", target_id: "material_master", module: "material_master" };

interface Case { route: string; path: string; query: Record<string, string>; schema: Schema }
const CASES: Case[] = Object.entries(api.paths).flatMap(([route, ops]) => {
  const schema = ops.get?.responses?.["200"]?.content?.["application/json"]?.schema;
  if (!schema || !Object.keys(schema).length || !route.startsWith("/api/v1/")) return [];
  const params = [...route.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (params.some((p) => !(p in IDS) || !IDS[p])) return [];
  const required = (ops.get?.parameters ?? []).filter((p) => p.in === "query" && p.required).map((p) => p.name);
  if (required.some((q) => !(q in QUERY))) return [];
  const query = Object.fromEntries(required.map((q) => [q, QUERY[q]]));
  const path = route.slice("/api/v1".length).replace(/\{(\w+)\}/g, (_, p: string) => encodeURIComponent(IDS[p]));
  return [{ route, path, query, schema }];
});

beforeAll(() => {
  window.sessionStorage.setItem("mn_v2_fixture", "1");
});

describe("fixture answers match the API's response schemas", () => {
  const answered: string[] = [];
  const failures: string[] = [];
  beforeAll(() => {
    for (const c of CASES) {
      let body: unknown;
      try {
        body = fixtureResponse(c.path, c.query);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) continue; // a route the fixtures do not answer, or that needs a query it was not given
        throw e;
      }
      if (body === undefined) continue;
      answered.push(c.route);
      for (const e of validate(c.schema, JSON.parse(JSON.stringify(body)))) failures.push(`${c.route} ${e}`);
    }
  });

  it("the fixtures answer the routes the interface reads most", () => {
    for (const r of ["/api/v1/landscape", "/api/v1/status", "/api/v1/objects/{module}/receipt", "/api/v1/people", "/api/v1/rules/coverage/{module}"]) expect(answered).toContain(r);
    expect(answered.length).toBeGreaterThanOrEqual(40);
  });

  it("the validator catches a wrong type, a missing field and a field the API does not send", () => {
    const schema = CASES.find((c) => c.route === "/api/v1/landscape")?.schema as Schema;
    const bad = JSON.parse(JSON.stringify(L)) as { cells: Record<string, unknown>[] };
    bad.cells[0].score = "70";
    delete bad.cells[0].module;
    bad.cells[0].measured = 71.8;
    const errs = validate(schema, bad);
    expect(errs.some((e) => e.includes(".score"))).toBe(true);
    expect(errs.some((e) => e.includes(".module: missing"))).toBe(true);
    expect(errs.some((e) => e.includes(".measured: the API does not send this field"))).toBe(true);
  });

  it("every answer conforms to the schema the API declares", () => {
    expect(failures).toEqual([]);
  });
});

/* ---- rules: the same as the shipped library ---- */

interface YamlRule { id: string; field?: string; severity: string; dimension: string; check_class: string; message: string; enabled?: boolean }
const RULE_DIR = join(HERE, "..", "..", "..", "..", "..", "checks", "rules", "ecc");
const YAML = new Map<string, YamlRule & { module: string }>();
for (const f of readdirSync(RULE_DIR).filter((n) => n.endsWith(".yaml") && n !== "column_map.yaml")) {
  const doc = load(readFileSync(join(RULE_DIR, f), "utf8"), { json: true }) as { module?: string; rules?: YamlRule[] } | null;
  for (const r of doc?.rules ?? []) if (r && r.id) YAML.set(r.id, { ...r, module: doc?.module ?? "" });
}
const words = (s: string) => s.split(/\s+/).join(" ").trim();

describe("the fixtures name only rules the engine has", () => {
  it("every rule of the library is an enabled rule of checks/rules with the same message, field, severity, dimension and class", () => {
    const wrong = LIBRARY.flatMap((r) => {
      const y = YAML.get(r.check_id);
      if (!y) return [`${r.check_id}: not in checks/rules`];
      const got = [r.module, r.name, r.field, r.severity, r.dimension, r.check_class];
      const want = [y.module, words(y.message), y.field ?? null, y.severity, y.dimension, y.check_class];
      return y.enabled === false ? [`${r.check_id}: disabled`] : JSON.stringify(got) === JSON.stringify(want) ? [] : [`${r.check_id}: ${JSON.stringify(got)} against ${JSON.stringify(want)}`];
    });
    expect(wrong).toEqual([]);
  });

  it("an object's failing rules, the capping rules and the landscape's breaches are rules of the library", () => {
    const lib = new Map(LIBRARY.map((r) => [r.check_id, r]));
    const wrong: string[] = [];
    for (const c of L.cells) {
      const rows = fixtureResponse<{ rules: RuleRow[] }>("/findings", { module: c.module }).rules;
      for (const r of rows) {
        const x = lib.get(r.check_id);
        if (!x || x.module !== c.module || x.name !== r.name || x.severity !== r.severity || x.failing !== r.affected_count) wrong.push(`/findings ${c.module} ${r.check_id}`);
      }
      const receipt = fixtureResponse<Receipt>(`/objects/${c.module}/receipt`, {});
      for (const b of receipt.breaches) {
        const x = lib.get(b.check_id);
        if (!x || x.module !== c.module || x.severity !== "critical" || x.name !== b.name || x.failing !== b.failing) wrong.push(`receipt ${c.module} ${b.check_id}`);
      }
      expect(new Set(c.breaches)).toEqual(new Set(receipt.breaches.map((b) => b.check_id)));
    }
    expect(wrong).toEqual([]);
  });

  it("rules measured agree across the landscape, each receipt, the status strip and the rules library", () => {
    const strip = L.status_strip?.rules_measured;
    let sum = 0;
    for (const c of L.cells) {
      const n = LIBRARY.filter((r) => r.module === c.module).length;
      const receipt = fixtureResponse<Receipt>(`/objects/${c.module}/receipt`, {});
      expect(c.rules_measured, c.module).toBe(n);
      expect(receipt.rules_measured, c.module).toBe(n);
      expect(receipt.dimensions.reduce((s, d) => s + (d.rules_measured ?? 0), 0), c.module).toBe(n);
      for (const d of receipt.dimensions) if (d.score != null) expect(d.rules_measured, `${c.module} ${d.key}`).toBeGreaterThan(0);
      sum += n;
    }
    expect(strip).toBe(sum);
    const lib = fixtureResponse<{ rules: unknown[]; total: number }>("/rules", { limit: 1000 });
    expect(lib.total).toBe(sum);
  });

  it("no rule is shown for a system the landscape says was not analysed", () => {
    const analysed = new Set(L.cells.map((c) => c.module));
    const lib = fixtureResponse<{ rules: { module: string }[] }>("/rules", { limit: 1000 });
    expect(lib.rules.filter((r) => !analysed.has(r.module))).toEqual([]);
  });
});
