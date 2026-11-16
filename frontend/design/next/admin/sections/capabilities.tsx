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
import { refreshRoles, useShareLinks, useStewardAssignments, useTemplate, useTemplateGaps } from "@/lib/v2/roles-queries";
import { useQuery } from "@tanstack/react-query";
import { getAllDelegations } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { ROLE_NAMES, setViewAs, VIEW_AS_ROLES } from "@/lib/v2/view-as";
import { int } from "@/lib/v2/score";
import { Coded, Mono } from "./parts";
import { AdminPage, Block, Confirm, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";
import { t as tr, lc } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { TableExport } from "./TableExport";
import { Button } from "@/design/next/kit";

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
      <ul className="nx-adm-diff" data-testid="template-diff">
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
  const current = useStewardAssignments();
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
                <div className="nx-table-scroll">
                  <TableExport><table className="nx-adm-tmpl" data-testid="template-table">
                    <thead>
                      <tr className="nx-tr">
                        <th className="nx-th" scope="col">{tr("Object")}</th>
                        <th className="nx-th" scope="col">{tr("Owner role")}</th>
                        <th className="nx-th" scope="col">{tr("Owner")}</th>
                        <th className="nx-th" scope="col">{tr("Stewards by")}</th>
                        <th className="nx-th" scope="col">{tr("Steward")}</th>
                        <th className="nx-th" scope="col">{tr("Teams")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(tmpl.objects).map(([m, o]) => (
                        <tr className="nx-tr" key={m}>
                          <th className="nx-th" scope="row">{t.labels[m] ?? m}</th>
                          <td className="nx-td">{o.owner_role}</td>
                          <td className="nx-td">{person(o.owner_user_id, (v) => set(m, { owner_user_id: v }), tr("Owner of {labels}", { labels: t.labels[m] ?? m }))}</td>
                          <td className="nx-td">
                            <select value={o.slice} onChange={(e) => set(m, { slice: e.target.value as SliceKind })} aria-label={tr("Slice of {labels}", { labels: t.labels[m] ?? m })}>
                              {Object.entries(SLICE_WORD).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="nx-td">{person(o.steward_user_id, (v) => set(m, { steward_user_id: v }), tr("Steward of {labels}", { labels: t.labels[m] ?? m }))}</td>
                          <td className="nx-td nx-reason">{o.stewards}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></TableExport>
                </div>
                <div className="nx-adm-acts">
                  <Button disabled={!draft} onClick={() => void run(async () => {
                    await putTemplate(tmpl);
                    setDraft(null);
                    setMsg(tr("Template saved."));
                    await refreshRoles(qc, "template");
                  })}>
                    {tr("Save the template")}
                  </Button>
                  <Button disabled={Boolean(draft)} aria-describedby={draft ? "template-apply-why" : undefined} onClick={() => void run(async () => setPlan(await applyTemplate(true)))}>
                    {tr("Check what applying does")}
                  </Button>
                  {draft ? <span id="template-apply-why" className="nx-reason">{tr("Save the template first")}</span> : null}
                  <Button variant="primary" disabled={!plan || Boolean(draft)} onClick={() => void run(async () => {
                    const done = await applyTemplate(false);
                    setPlan(null);
                    setMsg(tr("Applied: {add} added, {change} changed.", { add: done.totals.add, change: done.totals.change }));
                    await refreshRoles(qc);
                  })}>
                    {tr("Apply")}
                  </Button>
                </div>
                {plan ? <Diff plan={plan} /> : null}
                {error ? <Note tone="bad">{error}</Note> : null}
                {msg ? <p role="status">{msg}</p> : null}
              </Block>
              <Block title={tr("Stewards in place")} hint={tr("Who stewards each object and slice now, and whether the template or a person set it.")}>
                <Loaded q={current} what={tr("The steward assignments")}>
                  {(c) =>
                    c.assignments.length === 0 ? (
                      <p className="nx-reason">{tr("No steward is assigned yet. Apply the template to assign them.")}</p>
                    ) : (
                      <div className="nx-table-scroll">
                        <TableExport><table className="nx-adm-tmpl" data-testid="steward-assignments">
                          <thead>
                            <tr className="nx-tr">
                              <th className="nx-th" scope="col">{tr("Object")}</th>
                              <th className="nx-th" scope="col">{tr("Stewards by")}</th>
                              <th className="nx-th" scope="col">{tr("Value")}</th>
                              <th className="nx-th" scope="col">{tr("Steward")}</th>
                              <th className="nx-th" scope="col">{tr("Set by")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.assignments.map((a) => (
                              <tr className="nx-tr" key={`${a.module}|${a.slice_kind}|${a.slice_value}`}>
                                <th className="nx-th" scope="row">{t.labels[a.module] ?? a.module}</th>
                                <td className="nx-td">{SLICE_WORD[a.slice_kind] ?? a.slice_kind}</td>
                                <td className="nx-td">{a.slice_value === "*" ? tr("All") : a.slice_text ? <Coded code={a.slice_value} text={a.slice_text} /> : <Mono>{a.slice_value}</Mono>}</td>
                                <td className="nx-td">{a.steward_name ?? "—"}</td>
                                <td className="nx-td nx-reason">{a.source === "template" ? tr("The template") : tr("By hand")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table></TableExport>
                      </div>
                    )
                  }
                </Loaded>
              </Block>
              <Block title={tr("Gaps")} hint={tr("Every object needs one owner and at least one steward per active slice.")}>
                <Loaded q={gaps} what={tr("The gaps")}>
                  {(g) =>
                    g.gaps.length === 0 ? (
                      <StatusWord tone="go">{tr("No gaps across {objects} objects.", { objects: g.objects })}</StatusWord>
                    ) : (
                      <ul className="nx-adm-rows" data-testid="template-gaps">
                        {g.gaps.map((x, i) => (
                          <li key={`${x.module}-${x.gap}-${x.slice_value ?? ""}-${i}`}>
                            <StatusWord tone="no-go">{x.label}</StatusWord>
                            <span className="nx-reason">{x.sentence}</span>
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
    <label className="nx-field">
      <span >{label}</span>
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
        <Button onClick={() => void exportBundle().catch((e) => setError(failureText(e)))}>
          {tr("Download the bundle")}
        </Button>
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
            <ul className="nx-adm-diff">
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
            <Button variant="primary" disabled={!diff.dry_run || diff.totals.add + diff.totals.change === 0} onClick={() => void importBundle(bundle, false).then((d) => (setDiff(d), setMsg(tr("Imported: {add} added, {change} changed.", { add: d.totals.add, change: d.totals.change })))).catch((e) => setError(failureText(e)))}>
              {tr("Import")}
            </Button>
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
          <div className="nx-adm-acts">
            <label className="nx-field">
              <span >{tr("Role")}</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {VIEW_AS_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <Button variant="primary" onClick={() => void start()}>
              {tr("View as this role")}
            </Button>
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
        <div className="nx-adm-acts">
          <select value={fmt} onChange={(e) => setFmt(e.target.value as "yaml" | "xlsx")} aria-label={tr("Format")}>
            <option value="yaml">YAML</option>
            <option value="xlsx">{tr("Excel")}</option>
          </select>
          <Button disabled={!can("export")} onClick={() => void exportRulesBulk(fmt).catch((e) => setError(failureText(e)))}>
            {tr("Download the rules")}
          </Button>
        </div>
      </Block>
      <Block title={tr("Import")} hint={tr("A YAML list of rules (each with its module), or the Excel sheet the export writes.")}>
        {can("manage_rules") ? (
          <>
            <FileField label={tr("Rules file (YAML)")} accept=".yaml,.yml" onText={(t) => (setFile({ content: t, format: "yaml" }), setResult(null))} />
            <FileField label={tr("Rules file (Excel)")} accept=".xlsx" binary onText={(t) => (setFile({ content: t, format: "xlsx" }), setResult(null))} />
            <div className="nx-adm-acts">
              <Button disabled={!file} onClick={() => void send(true)}>
                {tr("Check the file")}
              </Button>
              <Button variant="primary" disabled={!result || !result.dry_run || result.valid === 0} onClick={() => void send(false)}>
                {result ? tr("Create {valid} {valid, plural, one {draft} other {drafts}}", { valid: result.valid }) : tr("Create drafts")}
              </Button>
            </div>
          </>
        ) : (
          <NeedsPermission what={tr("Importing rules")} permission="manage_rules" />
        )}
        {result ? (
          <div data-testid="bulk-result">
            <p>{result.dry_run ? tr("{valid} of {total} rules are valid.", { valid: result.valid, total: result.total }) : tr("{createdCount} drafts created; {invalid} rules were left out.", { createdCount: result.created.length, invalid: result.invalid })}</p>
            <ul className="nx-adm-diff">
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
  const [asking, setAsking] = useState<{ id: string; label: string } | null>(null);
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
            <p className="nx-reason">{tr("Nobody has shared a page yet.")}</p>
          ) : (
            <ul className="nx-adm-rows" data-testid="share-links">
              {d.links.map((l) => (
                <li key={l.id}>
                  <StatusWord tone={l.state_word === "active" ? "go" : "neutral"}>{l.label ?? l.route}</StatusWord>
                  <span className="nx-reason">{tr("{created_by_label}, {value}, opened {open_count} {open_count2, plural, one {time} other {times}}", { created_by_label: l.created_by_label ?? l.created_by, value: l.state_word === "active" ? tr("until {expires_at}", { expires_at: formatDate(l.expires_at, "date") }) : lc(labelText(l.state_word)), open_count: int(l.open_count), open_count2: l.open_count })}</span>
                  <Mono>{l.route}</Mono>
                  {l.state_word === "active" ? (
                    <Button variant="quiet" size={32} onClick={() => setAsking({ id: l.id, label: l.label ?? l.route })}>
                      {tr("Revoke")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <Note tone="bad">{error}</Note> : null}
      {asking ? (
        <Confirm
          title={tr("Revoke the share link to {label}", { label: asking.label })}
          body={tr("The link stops working at once. Anyone who opens it afterwards sees nothing; to share the page again, make a new link.")}
          confirm={tr("Revoke")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const id = asking.id;
            setAsking(null);
            void revokeShareLink(id).then(() => refreshRoles(qc, "links")).catch((e) => setError(failureText(e)));
          }}
        />
      ) : null}
    </AdminPage>
  );
}

export function DelegationsSection() {
  const can = useCan();
  const fx = useFixture();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["v2", "roles", fx, "delegations", "all"], queryFn: getAllDelegations, enabled: can("manage_users"), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ id: string; from: string; to: string } | null>(null);
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
            <p className="nx-reason">{tr("Nobody is away.")}</p>
          ) : (
            <ul className="nx-adm-rows" data-testid="all-delegations">
              {d.delegations.map((x) => (
                <li key={x.id}>
                  <span>{tr("{from_name} to {to_name}", { from_name: x.from_name, to_name: x.to_name })}</span>
                  <span className="nx-reason">{tr("{starts_on} to {ends_on}, {state}", { starts_on: x.starts_on, ends_on: x.ends_on, state: lc(labelText(x.state)) })}</span>
                  {x.state === "active" || x.state === "scheduled" ? (
                    <Button variant="quiet" size={32} onClick={() => setAsking({ id: x.id, from: x.from_name, to: x.to_name })}>
                      {tr("End it")}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        }
      </Loaded>
      {error ? <Note tone="bad">{error}</Note> : null}
      {asking ? (
        <Confirm
          title={tr("End the out of office of {from_name}", { from_name: asking.from })}
          body={tr("{to_name} stops covering the approvals and assigned work of {from_name} from now on.", { to_name: asking.to, from_name: asking.from })}
          confirm={tr("End it")}
          danger
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const id = asking.id;
            setAsking(null);
            void revokeDelegation(id).then(() => refreshRoles(qc, "delegations")).catch((e) => setError(failureText(e)));
          }}
        />
      ) : null}
    </AdminPage>
  );
}
