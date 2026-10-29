"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  applyTemplate, exportBundle, exportRulesBulk, importBundle, importRulesBulk, putTemplate, revokeDelegation, revokeShareLink, startViewAs,
  type ApplyPlan, type AssignmentTemplate, type BulkResult, type BundleDiff, type SliceKind,
} from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { refreshRoles, useShareLinks, useTemplate, useTemplateGaps } from "@/lib/v2/roles-queries";
import { useQuery } from "@tanstack/react-query";
import { getAllDelegations } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { ROLE_NAMES, setViewAs, VIEW_AS_ROLES } from "@/lib/v2/view-as";
import { int } from "@/lib/v2/score";
import { Mono } from "../parts";
import { AdminPage, Block, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";
import "../roles.css";
import { t as tr, lc } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

/**
 * The Admin sections the role capability audit added (step 6c): Stewardship (the assignment template, apply with a
 * dry-run diff, the gaps), Configuration bundle, View as a role, Rules import and export, Share links and Out of office.
 * Each checks its own permission and states the missing one rather than offering controls.
 */

const SLICE_WORD: Record<SliceKind, string> = { get company_code() { return tr("Company code"); }, get plant() { return tr("Plant"); }, get sales_org() { return tr("Sales organisation"); }, get purchasing_org() { return tr("Purchasing organisation"); }, get none() { return tr("Whole object"); } };

function Diff({ plan }: { plan: ApplyPlan }) {
  const rows = [...plan.owners.map((r) => ({ ...r, what: tr("Owner") })), ...plan.stewards.map((r) => ({ ...r, what: r.slice_value === "*" ? tr("Steward") : tr("Steward, {SLICE_WORD} {slice_value}", { SLICE_WORD: lc(SLICE_WORD[r.slice_kind ?? "none"]), slice_value: r.slice_value }) }))].filter((r) => r.change !== "same");
  return (
    <>
      <p>{tr("{add} to add, {change} to change, {same} already in place.", { add: plan.totals.add, change: plan.totals.change, same: plan.totals.same })}</p>
      <ul className="m2-diff" data-testid="template-diff">
        {rows.map((r, i) => (
          <li key={`${r.module}-${r.what}-${i}`} data-change={r.change}>{`${r.change === "add" ? tr("Add") : tr("Change")}: ${r.module.replace(/_/g, " ")}, ${r.what}`}</li>
        ))}
      </ul>
    </>
  );
}

export function StewardshipSection() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useTemplate();
  const gaps = useTemplateGaps();
  const people = useAssignable(true);
  const [draft, setDraft] = useState<AssignmentTemplate | null>(null);
  const [plan, setPlan] = useState<ApplyPlan | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!can("manage_settings")) {
    return (
      <AdminPage title={tr("Stewardship")}>
        <NeedsPermission what={tr("The steward assignment template")} permission="manage_settings" />
      </AdminPage>
    );
  }
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <AdminPage title={tr("Stewardship")} lead={tr("One accountable owner per object and one steward per company code, plant or organisation. The template below follows the approved best practice; name the people, check the diff, then apply.")}>
      <Loaded q={q} what={tr("The assignment template")}>
        {(t) => {
          const tmpl = draft ?? t.template;
          const set = (m: string, patch: Partial<AssignmentTemplate["objects"][string]>) => setDraft({ ...tmpl, objects: { ...tmpl.objects, [m]: { ...tmpl.objects[m], ...patch } } });
          const person = (value: string | null | undefined, onPick: (v: string | null) => void, label: string) => (
            <select value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} aria-label={label}>
              <option value="">{tr("Nobody yet")}</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          );
          return (
            <>
              <Block title={tr("Template")} hint={tr("{value}. Active slices: {map}.", { value: t.saved ? tr("Saved for this tenant") : tr("The default template"), map: (["plant", "company_code", "sales_org", "purchasing_org"] as SliceKind[]).map((k) => `${lc(SLICE_WORD[k])} ${(t.active_slices[k] ?? []).join(", ") || tr("none")}`).join("; ") })}>
                <div className="m2-scroll">
                  <table className="m2-tmpl" data-testid="template-table">
                    <thead>
                      <tr>
                        <th scope="col">{tr("Object")}</th>
                        <th scope="col">{tr("Owner role")}</th>
                        <th scope="col">{tr("Owner")}</th>
                        <th scope="col">{tr("Stewards by")}</th>
                        <th scope="col">{tr("Steward")}</th>
                        <th scope="col">{tr("Teams")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(tmpl.objects).map(([m, o]) => (
                        <tr key={m}>
                          <th scope="row">{t.labels[m] ?? m}</th>
                          <td>{o.owner_role}</td>
                          <td>{person(o.owner_user_id, (v) => set(m, { owner_user_id: v }), tr("Owner of {labels}", { labels: t.labels[m] ?? m }))}</td>
                          <td>
                            <select value={o.slice} onChange={(e) => set(m, { slice: e.target.value as SliceKind })} aria-label={tr("Slice of {labels}", { labels: t.labels[m] ?? m })}>
                              {Object.entries(SLICE_WORD).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{person(o.steward_user_id, (v) => set(m, { steward_user_id: v }), tr("Steward of {labels}", { labels: t.labels[m] ?? m }))}</td>
                          <td className="m2-meta">{o.stewards}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="m2-adm-acts">
                  <button type="button" className="m2-btn" disabled={!draft} onClick={() => void run(async () => {
                    await putTemplate(tmpl);
                    setDraft(null);
                    setMsg(tr("Template saved."));
                    await refreshRoles(qc, "template");
                  })}>
                    {tr("Save the template")}
                  </button>
                  <button type="button" className="m2-btn" disabled={Boolean(draft)} title={draft ? tr("Save the template first") : undefined} onClick={() => void run(async () => setPlan(await applyTemplate(true)))}>
                    {tr("Check what applying does")}
                  </button>
                  <button type="button" className="m2-btn m2-strong" disabled={!plan || Boolean(draft)} onClick={() => void run(async () => {
                    const done = await applyTemplate(false);
                    setPlan(null);
                    setMsg(tr("Applied: {add} added, {change} changed.", { add: done.totals.add, change: done.totals.change }));
                    await refreshRoles(qc);
                  })}>
                    {tr("Apply")}
                  </button>
                </div>
                {plan ? <Diff plan={plan} /> : null}
                {error ? <Note tone="bad">{error}</Note> : null}
                {msg ? <p role="status">{msg}</p> : null}
              </Block>
              <Block title={tr("Gaps")} hint={tr("Every object needs one owner and at least one steward per active slice.")}>
                <Loaded q={gaps} what={tr("The gaps")}>
                  {(g) =>
                    g.gaps.length === 0 ? (
                      <StatusWord tone="go">{tr("No gaps across {objects} objects.", { objects: g.objects })}</StatusWord>
                    ) : (
                      <ul className="m2-rows" data-testid="template-gaps">
                        {g.gaps.map((x, i) => (
                          <li key={`${x.module}-${x.gap}-${x.slice_value ?? ""}-${i}`}>
                            <StatusWord tone="no-go">{x.label}</StatusWord>
                            <span className="m2-meta">{x.sentence}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Loaded>
              </Block>
            </>
          );
        }}
      </Loaded>
    </AdminPage>
  );
}

function FileField({ label, accept, onText, binary }: { label: string; accept: string; onText: (text: string, name: string) => void; binary?: boolean }) {
  return (
    <label className="m2-fld">
      <span className="m2-lbl">{label}</span>
      <input
        type="file"
        accept={accept}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (binary) {
            void f.arrayBuffer().then((buf) => {
              let s = "";
              new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
              onText(window.btoa(s), f.name);
            });
          } else void f.text().then((t) => onText(t, f.name));
        }}
      />
    </label>
  );
}

export function ConfigBundleSection() {
  const can = useCan();
  const [bundle, setBundle] = useState<unknown>(null);
  const [diff, setDiff] = useState<BundleDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!can("manage_settings")) {
    return (
      <AdminPage title={tr("Configuration bundle")}>
        <NeedsPermission what={tr("The configuration bundle")} permission="manage_settings" />
      </AdminPage>
    );
  }
  const check = async (b: unknown) => {
    setError(null);
    setMsg(null);
    try {
      setDiff(await importBundle(b, true));
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <AdminPage title={tr("Configuration bundle")} lead={tr("Rules switched on or off, field mappings, waves and their gates, settings, SLA policies and the escalation chain as one JSON file. Move a configuration from a test tenant to production, or keep it under version control.")}>
      <Block title={tr("Export")}>
        <button type="button" className="m2-btn" onClick={() => void exportBundle().catch((e) => setError(failureText(e)))}>
          {tr("Download the bundle")}
        </button>
      </Block>
      <Block title={tr("Import")} hint={tr("Import adds and changes; it never deletes what the file leaves out. Check the diff first.")}>
        <FileField
          label={tr("Bundle file")}
          accept=".json,application/json"
          onText={(t) => {
            try {
              const b: unknown = JSON.parse(t);
              setBundle(b);
              void check(b);
            } catch {
              setError(tr("The file is not JSON."));
            }
          }}
        />
        {diff ? (
          <div data-testid="bundle-diff">
            <p>{tr("{add} to add, {change} to change, {same} the same, {kept} kept as they are.", { add: diff.totals.add, change: diff.totals.change, same: diff.totals.same, kept: diff.totals.kept })}</p>
            <ul className="m2-diff">
              {Object.entries(diff.sections).flatMap(([section, d]) =>
                d.items
                  .filter((i) => i.change !== "same")
                  .map((i) => (
                    <li key={`${section}-${i.key}`} data-change={i.change}>
                      {`${i.change === "add" ? tr("Add") : tr("Change")} ${section.replace(/_/g, " ")}: `}
                      <Mono>{i.key}</Mono>
                    </li>
                  )),
              )}
            </ul>
            <button type="button" className="m2-btn m2-strong" disabled={!diff.dry_run || diff.totals.add + diff.totals.change === 0} onClick={() => void importBundle(bundle, false).then((d) => (setDiff(d), setMsg(tr("Imported: {add} added, {change} changed.", { add: d.totals.add, change: d.totals.change })))).catch((e) => setError(failureText(e)))}>
              {tr("Import")}
            </button>
          </div>
        ) : null}
        {error ? <Note tone="bad">{error}</Note> : null}
        {msg ? <p role="status">{msg}</p> : null}
      </Block>
    </AdminPage>
  );
}

export function ViewAsSection() {
  const can = useCan();
  const session = useV2Session();
  const qc = useQueryClient();
  const [role, setRole] = useState(VIEW_AS_ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  if (!can("manage_users") && !session.viewAs) {
    return (
      <AdminPage title={tr("View as a role")}>
        <NeedsPermission what={tr("Viewing as a role")} permission="manage_users" />
      </AdminPage>
    );
  }
  const start = async () => {
    setError(null);
    try {
      await startViewAs(role);
      setViewAs(role);
      await qc.invalidateQueries();
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <AdminPage title={tr("View as a role")} lead={tr("See the product as one role sees it, to answer a support question or check a role before you grant it. Everything is read-only while you view as a role, and starting and stopping are in the audit log.")}>
      <Block>
        {session.viewAs ? (
          <Note tone="warn">{tr("You are viewing as {ROLE_NAMES}. Stop from the bar at the top of the page.", { ROLE_NAMES: ROLE_NAMES[session.viewAs] ?? session.viewAs })}</Note>
        ) : (
          <div className="m2-adm-acts">
            <label className="m2-fld">
              <span className="m2-lbl">{tr("Role")}</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {VIEW_AS_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="m2-btn m2-strong" onClick={() => void start()}>
              {tr("View as this role")}
            </button>
          </div>
        )}
        {error ? <Note tone="bad">{error}</Note> : null}
      </Block>
    </AdminPage>
  );
}

export function RulesIoSection() {
  const can = useCan();
  const [fmt, setFmt] = useState<"yaml" | "xlsx">("yaml");
  const [file, setFile] = useState<{ content: string; format: "yaml" | "xlsx" } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!can("manage_rules") && !can("export")) {
    return (
      <AdminPage title={tr("Rules import and export")}>
        <NeedsPermission what={tr("Rules import and export")} permission="manage_rules" />
      </AdminPage>
    );
  }
  const send = async (dry: boolean) => {
    if (!file) return;
    setError(null);
    try {
      setResult(await importRulesBulk(file.format, file.content, dry));
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <AdminPage title={tr("Rules import and export")} lead={tr("Every rule of the tenant as YAML or Excel, and many rules at once back in. Imported rules are validated against the data dictionary and land as drafts for review, never live.")}>
      <Block title={tr("Export")}>
        <div className="m2-adm-acts">
          <select value={fmt} onChange={(e) => setFmt(e.target.value as "yaml" | "xlsx")} aria-label={tr("Format")}>
            <option value="yaml">YAML</option>
            <option value="xlsx">{tr("Excel")}</option>
          </select>
          <button type="button" className="m2-btn" disabled={!can("export")} onClick={() => void exportRulesBulk(fmt).catch((e) => setError(failureText(e)))}>
            {tr("Download the rules")}
          </button>
        </div>
      </Block>
      <Block title={tr("Import")} hint={tr("A YAML list of rules (each with its module), or the Excel sheet the export writes.")}>
        {can("manage_rules") ? (
          <>
            <FileField label={tr("Rules file (YAML)")} accept=".yaml,.yml" onText={(t) => (setFile({ content: t, format: "yaml" }), setResult(null))} />
            <FileField label={tr("Rules file (Excel)")} accept=".xlsx" binary onText={(t) => (setFile({ content: t, format: "xlsx" }), setResult(null))} />
            <div className="m2-adm-acts">
              <button type="button" className="m2-btn" disabled={!file} onClick={() => void send(true)}>
                {tr("Check the file")}
              </button>
              <button type="button" className="m2-btn m2-strong" disabled={!result || !result.dry_run || result.valid === 0} onClick={() => void send(false)}>
                {result ? tr("Create {valid} {valid, plural, one {draft} other {drafts}}", { valid: result.valid }) : tr("Create drafts")}
              </button>
            </div>
          </>
        ) : (
          <NeedsPermission what={tr("Importing rules")} permission="manage_rules" />
        )}
        {result ? (
          <div data-testid="bulk-result">
            <p>{result.dry_run ? tr("{valid} of {total} rules are valid.", { valid: result.valid, total: result.total }) : tr("{createdCount} drafts created; {invalid} rules were left out.", { createdCount: result.created.length, invalid: result.invalid })}</p>
            <ul className="m2-diff">
              {result.rows.map((r) => (
                <li key={r.row} data-change={r.ok ? "add" : "change"}>
                  {tr("Row {row}{value}: {value2}", { row: r.row, value: r.id ? ` (${r.id})` : "", value2: r.ok ? tr("valid") : r.errors.join("; ") })}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <Note tone="bad">{error}</Note> : null}
      </Block>
    </AdminPage>
  );
}

export function ShareLinksSection() {
  const can = useCan();
  const qc = useQueryClient();
  const q = useShareLinks(true);
  const [error, setError] = useState<string | null>(null);
  if (!can("manage_users")) {
    return (
      <AdminPage title={tr("Share links")}>
        <NeedsPermission what={tr("Every share link of the tenant")} permission="manage_users" />
      </AdminPage>
    );
  }
  return (
    <AdminPage title={tr("Share links")} lead={tr("Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once.")}>
      <Loaded q={q} what={tr("The share links")}>
        {(d) =>
          d.links.length === 0 ? (
            <p className="m2-meta">{tr("Nobody has shared a page yet.")}</p>
          ) : (
            <ul className="m2-rows" data-testid="share-links">
              {d.links.map((l) => (
                <li key={l.id}>
                  <StatusWord tone={l.state_word === "active" ? "go" : "neutral"}>{l.label ?? l.route}</StatusWord>
                  <span className="m2-meta">{tr("{created_by_label}, {value}, opened {open_count} {open_count2, plural, one {time} other {times}}", { created_by_label: l.created_by_label ?? l.created_by, value: l.state_word === "active" ? tr("until {expires_at}", { expires_at: formatDate(l.expires_at, "date") }) : lc(labelText(l.state_word)), open_count: int(l.open_count), open_count2: l.open_count })}</span>
                  <Mono>{l.route}</Mono>
                  {l.state_word === "active" ? (
                    <button type="button" className="m2-linkbtn2" onClick={() => void revokeShareLink(l.id).then(() => refreshRoles(qc, "links")).catch((e) => setError(failureText(e)))}>
                      {tr("Revoke")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <Note tone="bad">{error}</Note> : null}
    </AdminPage>
  );
}

export function DelegationsSection() {
  const can = useCan();
  const fx = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["v2", "roles", fx, "delegations", "all"], queryFn: getAllDelegations, enabled: can("manage_users"), retry: false });
  const [error, setError] = useState<string | null>(null);
  if (!can("manage_users")) {
    return (
      <AdminPage title={tr("Out of office")}>
        <NeedsPermission what={tr("Everyone's out of office")} permission="manage_users" />
      </AdminPage>
    );
  }
  return (
    <AdminPage title={tr("Out of office")} lead={tr("Who is away and who covers their approvals and assigned work. Each person sets their own from Preferences; an administrator can end one.")}>
      <Loaded q={q} what={tr("The delegations")}>
        {(d) =>
          d.delegations.length === 0 ? (
            <p className="m2-meta">{tr("Nobody is away.")}</p>
          ) : (
            <ul className="m2-rows" data-testid="all-delegations">
              {d.delegations.map((x) => (
                <li key={x.id}>
                  <span>{tr("{from_name} to {to_name}", { from_name: x.from_name, to_name: x.to_name })}</span>
                  <span className="m2-meta">{tr("{starts_on} to {ends_on}, {state}", { starts_on: x.starts_on, ends_on: x.ends_on, state: lc(labelText(x.state)) })}</span>
                  {x.state === "active" || x.state === "scheduled" ? (
                    <button type="button" className="m2-linkbtn2" onClick={() => void revokeDelegation(x.id).then(() => refreshRoles(qc, "delegations")).catch((e) => setError(failureText(e)))}>
                      {tr("End it")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <Note tone="bad">{error}</Note> : null}
    </AdminPage>
  );
}
