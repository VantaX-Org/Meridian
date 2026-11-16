"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyTemplate, exportBundle, exportRulesBulk, importBundle, importRulesBulk, putTemplate,
  type ApplyPlan, type AssignmentTemplate, type BulkResult, type BundleDiff, type SliceKind, type StewardAssignment, type TemplateObject,
} from "@/lib/api/v2/roles";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { refreshRoles, useStewardAssignments, useTemplate, useTemplateGaps } from "@/lib/v2/roles-queries";
import { t, lc } from "@/lib/v2/i18n";
import { Button, Chip, Code, DataTable, DropZone, EmptyState } from "../kit";
import { DataBlock, DataLoaded, DataPage, NeedsPermission, useAct, useCan } from "./data-parts";

const SLICE_WORD: Record<SliceKind, () => string> = {
  company_code: () => t("Company code"),
  plant: () => t("Plant"),
  sales_org: () => t("Sales organisation"),
  purchasing_org: () => t("Purchasing organisation"),
  none: () => t("Whole object"),
};
const slice = (k: SliceKind | null | undefined): string => (SLICE_WORD[k ?? "none"] ?? SLICE_WORD.none)();

function Diff({ plan }: { plan: ApplyPlan }) {
  const rows = [
    ...plan.owners.map((r) => ({ ...r, what: t("Owner") })),
    ...plan.stewards.map((r) => ({ ...r, what: r.slice_value === "*" ? t("Steward") : t("Steward, {SLICE_WORD} {slice_value}", { SLICE_WORD: lc(slice(r.slice_kind)), slice_value: r.slice_value ?? "" }) })),
  ].filter((r) => r.change !== "same");
  return (
    <div data-testid="template-diff">
      <p>{t("{add} to add, {change} to change, {same} already in place.", { add: plan.totals.add, change: plan.totals.change, same: plan.totals.same })}</p>
      <ul className="nx-data-list">
        {rows.map((r, i) => (
          <li key={`${r.module}-${r.what}-${i}`} data-change={r.change}>{`${r.change === "add" ? t("Add") : t("Change")}: ${r.module.replace(/_/g, " ")}, ${r.what}`}</li>
        ))}
      </ul>
    </div>
  );
}

/** Admin › Stewardship: the assignment template (one owner per object, one steward per slice), apply with a dry-run diff, the gaps. */
export function StewardshipSection() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useTemplate();
  const gaps = useTemplateGaps();
  const current = useStewardAssignments();
  const people = useAssignable(true);
  const [draft, setDraft] = useState<AssignmentTemplate | null>(null);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const { pending, act } = useAct();
  if (!can("manage_settings")) return <NeedsPermission what={t("The steward assignment template")} permission="manage_settings" />;
  return (
    <DataPage lead={t("One accountable owner per object and one steward per company code, plant or organisation. The template below follows the approved best practice; name the people, check the diff, then apply.")}>
      <DataLoaded q={q} what={t("The assignment template")}>
        {(d) => {
          const tmpl = draft ?? d.template;
          const label = (m: string) => d.labels[m] ?? m;
          const set = (m: string, patch: Partial<TemplateObject>) => setDraft({ ...tmpl, objects: { ...tmpl.objects, [m]: { ...tmpl.objects[m], ...patch } } });
          const person = (value: string | null | undefined, onPick: (v: string | null) => void, aria: string) => (
            <select className="nx-input" value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} aria-label={aria}>
              <option value="">{t("Nobody yet")}</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          );
          const rows = Object.entries(tmpl.objects).map(([m, o]) => ({ m, o }));
          const activeHint = (["plant", "company_code", "sales_org", "purchasing_org"] as SliceKind[]).map((k) => `${lc(slice(k))} ${(d.active_slices[k] ?? []).join(", ") || t("none")}`).join("; ");
          return (
            <>
              <DataBlock title={t("Template")} hint={t("{value}. Active slices: {map}.", { value: d.saved ? t("Saved for this tenant") : t("The default template"), map: activeHint })}>
                <div data-testid="template-table">
                  <DataTable<(typeof rows)[number]>
                    caption={t("Template")}
                    rows={rows}
                    rowKey={(r) => r.m}
                    rowLabel={(r) => label(r.m)}
                    empty={{ heading: t("The assignment template") }}
                    columns={[
                      { id: "object", label: t("Object"), cell: (r) => label(r.m) },
                      { id: "role", label: t("Owner role"), cell: (r) => r.o.owner_role },
                      { id: "owner", label: t("Owner"), cell: (r) => person(r.o.owner_user_id, (v) => set(r.m, { owner_user_id: v }), t("Owner of {labels}", { labels: label(r.m) })) },
                      {
                        id: "slice",
                        label: t("Stewards by"),
                        cell: (r) => (
                          <select className="nx-input" value={r.o.slice} onChange={(e) => set(r.m, { slice: e.target.value as SliceKind })} aria-label={t("Slice of {labels}", { labels: label(r.m) })}>
                            {(Object.keys(SLICE_WORD) as SliceKind[]).map((k) => (
                              <option key={k} value={k}>
                                {slice(k)}
                              </option>
                            ))}
                          </select>
                        ),
                      },
                      { id: "steward", label: t("Steward"), cell: (r) => person(r.o.steward_user_id, (v) => set(r.m, { steward_user_id: v }), t("Steward of {labels}", { labels: label(r.m) })) },
                      { id: "teams", label: t("Teams"), cell: (r) => r.o.stewards },
                    ]}
                  />
                </div>
                <div className="nx-data-actions">
                  <Button
                    disabled={!draft || pending !== null}
                    loading={pending === "save"}
                    data-testid="template-save"
                    onClick={() =>
                      void act("save", async () => {
                        await putTemplate(tmpl);
                        setDraft(null);
                        await refreshRoles(qc, "template");
                        return t("Template saved.");
                      })
                    }
                  >
                    {t("Save the template")}
                  </Button>
                  <Button
                    disabled={Boolean(draft) || pending !== null}
                    reason={draft ? t("Save the template first") : undefined}
                    loading={pending === "check"}
                    data-testid="template-check"
                    onClick={() => void act("check", async () => setPlan(await applyTemplate(true)))}
                  >
                    {t("Check what applying does")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!plan || Boolean(draft) || pending !== null}
                    loading={pending === "apply"}
                    onClick={() =>
                      void act("apply", async () => {
                        const done = await applyTemplate(false);
                        setPlan(null);
                        await refreshRoles(qc);
                        return t("Applied: {add} added, {change} changed.", { add: done.totals.add, change: done.totals.change });
                      })
                    }
                  >
                    {t("Apply")}
                  </Button>
                </div>
                {plan ? <Diff plan={plan} /> : null}
              </DataBlock>
              <DataBlock title={t("Stewards in place")} hint={t("Who stewards each object and slice now, and whether the template or a person set it.")}>
                <DataLoaded q={current} what={t("The steward assignments")} rows={3}>
                  {(c) =>
                    c.assignments.length === 0 ? (
                      <EmptyState heading={t("No steward is assigned yet. Apply the template to assign them.")} />
                    ) : (
                      <div data-testid="steward-assignments">
                        <DataTable<StewardAssignment>
                          caption={t("Stewards in place")}
                          rows={c.assignments}
                          rowKey={(a) => `${a.module}|${a.slice_kind}|${a.slice_value}`}
                          rowLabel={(a) => label(a.module)}
                          columns={[
                            { id: "object", label: t("Object"), cell: (a) => label(a.module) },
                            { id: "by", label: t("Stewards by"), cell: (a) => slice(a.slice_kind) },
                            { id: "value", label: t("Value"), cell: (a) => (a.slice_value === "*" ? t("All") : <Code code={a.slice_value} text={a.slice_text ?? undefined} />) },
                            { id: "steward", label: t("Steward"), cell: (a) => a.steward_name ?? "—" },
                            { id: "source", label: t("Set by"), cell: (a) => (a.source === "template" ? t("The template") : t("By hand")) },
                          ]}
                        />
                      </div>
                    )
                  }
                </DataLoaded>
              </DataBlock>
              <DataBlock title={t("Gaps")} hint={t("Every object needs one owner and at least one steward per active slice.")}>
                <DataLoaded q={gaps} what={t("The gaps")} rows={2}>
                  {(g) =>
                    g.gaps.length === 0 ? (
                      <Chip tone="good">{t("No gaps across {objects} objects.", { objects: g.objects })}</Chip>
                    ) : (
                      <ul className="nx-data-list" data-testid="template-gaps">
                        {g.gaps.map((x, i) => (
                          <li key={`${x.module}-${x.gap}-${x.slice_value ?? ""}-${i}`}>
                            <Chip tone="bad">{x.label}</Chip> <span className="nx-sub">{x.sentence}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </DataLoaded>
              </DataBlock>
            </>
          );
        }}
      </DataLoaded>
    </DataPage>
  );
}

const readBase64 = async (f: File): Promise<string> => {
  let s = "";
  new Uint8Array(await f.arrayBuffer()).forEach((b) => (s += String.fromCharCode(b)));
  return window.btoa(s);
};

/** Admin › Configuration bundle: download the tenant configuration as JSON; import with a dry-run diff first. */
export function ConfigBundleSection() {
  const can = useCan();
  const [bundle, setBundle] = useState<unknown>(null);
  const [diff, setDiff] = useState<BundleDiff | null>(null);
  const [bad, setBad] = useState<string | null>(null);
  const { pending, act } = useAct();
  if (!can("manage_settings")) return <NeedsPermission what={t("The configuration bundle")} permission="manage_settings" />;
  return (
    <DataPage lead={t("Rules switched on or off, field mappings, waves and their gates, settings, SLA policies and the escalation chain as one JSON file. Move a configuration from a test tenant to production, or keep it under version control.")}>
      <DataBlock title={t("Export")}>
        <div className="nx-data-actions">
          <Button loading={pending === "export"} data-testid="bundle-export" onClick={() => void act("export", () => exportBundle())}>
            {t("Download the bundle")}
          </Button>
        </div>
      </DataBlock>
      <DataBlock title={t("Import")} hint={t("Import adds and changes; it never deletes what the file leaves out. Check the diff first.")}>
        <DropZone
          label={t("Bundle file")}
          accept=".json,application/json"
          hint={t("The JSON file the export writes.")}
          busy={pending !== null}
          onFiles={(files) =>
            void files[0]?.text().then((text) => {
              let b: unknown;
              try {
                b = JSON.parse(text);
              } catch {
                setBad(t("The file is not JSON."));
                return;
              }
              setBad(null);
              setBundle(b);
              void act("check", async () => setDiff(await importBundle(b, true)));
            })
          }
        />
        {bad ? (
          <p className="nx-data-bad" role="alert">
            {bad}
          </p>
        ) : null}
        {diff ? (
          <div data-testid="bundle-diff">
            <p>{t("{add} to add, {change} to change, {same} the same, {kept} kept as they are.", { add: diff.totals.add, change: diff.totals.change, same: diff.totals.same, kept: diff.totals.kept })}</p>
            <ul className="nx-data-list">
              {Object.entries(diff.sections).flatMap(([section, d]) =>
                d.items
                  .filter((i) => i.change !== "same")
                  .map((i) => (
                    <li key={`${section}-${i.key}`} data-change={i.change}>
                      {`${i.change === "add" ? t("Add") : t("Change")} ${section.replace(/_/g, " ")}: `}
                      <Code code={i.key} />
                    </li>
                  )),
              )}
            </ul>
            <div className="nx-data-actions">
              <Button
                variant="primary"
                disabled={!diff.dry_run || diff.totals.add + diff.totals.change === 0 || pending !== null}
                loading={pending === "import"}
                data-testid="bundle-import"
                onClick={() =>
                  void act("import", async () => {
                    const d = await importBundle(bundle, false);
                    setDiff(d);
                    return t("Imported: {add} added, {change} changed.", { add: d.totals.add, change: d.totals.change });
                  })
                }
              >
                {t("Import")}
              </Button>
            </div>
          </div>
        ) : null}
      </DataBlock>
    </DataPage>
  );
}

/** Admin › Rules import and export: every rule as YAML or Excel; import checks the file first, then lands drafts. */
export function RulesIoSection() {
  const can = useCan();
  const [fmt, setFmt] = useState<"yaml" | "xlsx">("yaml");
  const [file, setFile] = useState<{ content: string; format: "yaml" | "xlsx" } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const { pending, act } = useAct();
  if (!can("manage_rules") && !can("export")) return <NeedsPermission what={t("Rules import and export")} permission="manage_rules" />;
  const send = (dry: boolean) => {
    if (!file) return;
    void act(dry ? "check" : "create", async () => setResult(await importRulesBulk(file.format, file.content, dry)));
  };
  const take = (format: "yaml" | "xlsx") => (files: File[]) => {
    const f = files[0];
    if (!f) return;
    void (format === "xlsx" ? readBase64(f) : f.text()).then((content) => {
      setFile({ content, format });
      setResult(null);
    });
  };
  return (
    <DataPage lead={t("Every rule of the tenant as YAML or Excel, and many rules at once back in. Imported rules are validated against the data dictionary and land as drafts for review, never live.")}>
      <DataBlock title={t("Export")}>
        <div className="nx-data-actions">
          <select className="nx-input" value={fmt} onChange={(e) => setFmt(e.target.value as "yaml" | "xlsx")} aria-label={t("Format")}>
            {/* i18n-ignore: YAML is the file format name */}
            <option value="yaml">YAML</option>
            <option value="xlsx">{t("Excel")}</option>
          </select>
          <Button disabled={!can("export")} loading={pending === "export"} data-testid="rules-export" onClick={() => void act("export", () => exportRulesBulk(fmt))}>
            {t("Download the rules")}
          </Button>
        </div>
      </DataBlock>
      <DataBlock title={t("Import")} hint={t("A YAML list of rules (each with its module), or the Excel sheet the export writes.")}>
        {can("manage_rules") ? (
          <>
            <div className="nx-data-form">
              <DropZone label={t("Rules file (YAML)")} accept=".yaml,.yml" hint={t("Rules file (YAML)")} busy={pending !== null} onFiles={take("yaml")} />
              <DropZone label={t("Rules file (Excel)")} accept=".xlsx" hint={t("Rules file (Excel)")} busy={pending !== null} onFiles={take("xlsx")} />
            </div>
            <div className="nx-data-actions">
              <Button disabled={!file || pending !== null} loading={pending === "check"} data-testid="rules-check" onClick={() => send(true)}>
                {t("Check the file")}
              </Button>
              <Button variant="primary" disabled={!result || !result.dry_run || result.valid === 0 || pending !== null} loading={pending === "create"} onClick={() => send(false)}>
                {result ? t("Create {valid} {valid, plural, one {draft} other {drafts}}", { valid: result.valid }) : t("Create drafts")}
              </Button>
            </div>
          </>
        ) : (
          <NeedsPermission what={t("Importing rules")} permission="manage_rules" />
        )}
        {result ? (
          <div data-testid="bulk-result">
            <p>{result.dry_run ? t("{valid} of {total} rules are valid.", { valid: result.valid, total: result.total }) : t("{createdCount} drafts created; {invalid} rules were left out.", { createdCount: result.created.length, invalid: result.invalid })}</p>
            <ul className="nx-data-list">
              {result.rows.map((r) => (
                <li key={r.row} data-change={r.ok ? "add" : "change"} className={r.ok ? undefined : "nx-data-bad"}>
                  {t("Row {row}{value}: {value2}", { row: r.row, value: r.id ? ` (${r.id})` : "", value2: r.ok ? t("valid") : r.errors.join("; ") })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DataBlock>
    </DataPage>
  );
}
