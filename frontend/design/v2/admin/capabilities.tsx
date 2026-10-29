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

/**
 * The Admin sections the role capability audit added (step 6c): Stewardship (the assignment template, apply with a
 * dry-run diff, the gaps), Configuration bundle, View as a role, Rules import and export, Share links and Out of office.
 * Each checks its own permission and states the missing one rather than offering controls.
 */

const SLICE_WORD: Record<SliceKind, string> = { company_code: "Company code", plant: "Plant", sales_org: "Sales organisation", purchasing_org: "Purchasing organisation", none: "Whole object" };

function Diff({ plan }: { plan: ApplyPlan }) {
  const rows = [...plan.owners.map((r) => ({ ...r, what: "Owner" })), ...plan.stewards.map((r) => ({ ...r, what: r.slice_value === "*" ? "Steward" : `Steward, ${SLICE_WORD[r.slice_kind ?? "none"].toLowerCase()} ${r.slice_value}` }))].filter((r) => r.change !== "same");
  return (
    <>
      <p>{`${plan.totals.add} to add, ${plan.totals.change} to change, ${plan.totals.same} already in place.`}</p>
      <ul className="m2-diff" data-testid="template-diff">
        {rows.map((r, i) => (
          <li key={`${r.module}-${r.what}-${i}`} data-change={r.change}>{`${r.change === "add" ? "Add" : "Change"}: ${r.module.replace(/_/g, " ")}, ${r.what}`}</li>
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
      <AdminPage title="Stewardship">
        <NeedsPermission what="The steward assignment template" permission="manage_settings" />
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
    <AdminPage title="Stewardship" lead="One accountable owner per object and one steward per company code, plant or organisation. The template below follows the approved best practice; name the people, check the diff, then apply.">
      <Loaded q={q} what="The assignment template">
        {(t) => {
          const tmpl = draft ?? t.template;
          const set = (m: string, patch: Partial<AssignmentTemplate["objects"][string]>) => setDraft({ ...tmpl, objects: { ...tmpl.objects, [m]: { ...tmpl.objects[m], ...patch } } });
          const person = (value: string | null | undefined, onPick: (v: string | null) => void, label: string) => (
            <select value={value ?? ""} onChange={(e) => onPick(e.target.value || null)} aria-label={label}>
              <option value="">Nobody yet</option>
              {(people.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          );
          return (
            <>
              <Block title="Template" hint={`${t.saved ? "Saved for this tenant" : "The default template"}. Active slices: ${(["plant", "company_code", "sales_org", "purchasing_org"] as SliceKind[]).map((k) => `${SLICE_WORD[k].toLowerCase()} ${(t.active_slices[k] ?? []).join(", ") || "none"}`).join("; ")}.`}>
                <div className="m2-scroll">
                  <table className="m2-tmpl" data-testid="template-table">
                    <thead>
                      <tr>
                        <th scope="col">Object</th>
                        <th scope="col">Owner role</th>
                        <th scope="col">Owner</th>
                        <th scope="col">Stewards by</th>
                        <th scope="col">Steward</th>
                        <th scope="col">Teams</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(tmpl.objects).map(([m, o]) => (
                        <tr key={m}>
                          <th scope="row">{t.labels[m] ?? m}</th>
                          <td>{o.owner_role}</td>
                          <td>{person(o.owner_user_id, (v) => set(m, { owner_user_id: v }), `Owner of ${t.labels[m] ?? m}`)}</td>
                          <td>
                            <select value={o.slice} onChange={(e) => set(m, { slice: e.target.value as SliceKind })} aria-label={`Slice of ${t.labels[m] ?? m}`}>
                              {Object.entries(SLICE_WORD).map(([k, l]) => (
                                <option key={k} value={k}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>{person(o.steward_user_id, (v) => set(m, { steward_user_id: v }), `Steward of ${t.labels[m] ?? m}`)}</td>
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
                    setMsg("Template saved.");
                    await refreshRoles(qc, "template");
                  })}>
                    Save the template
                  </button>
                  <button type="button" className="m2-btn" disabled={Boolean(draft)} title={draft ? "Save the template first" : undefined} onClick={() => void run(async () => setPlan(await applyTemplate(true)))}>
                    Check what applying does
                  </button>
                  <button type="button" className="m2-btn m2-strong" disabled={!plan || Boolean(draft)} onClick={() => void run(async () => {
                    const done = await applyTemplate(false);
                    setPlan(null);
                    setMsg(`Applied: ${done.totals.add} added, ${done.totals.change} changed.`);
                    await refreshRoles(qc);
                  })}>
                    Apply
                  </button>
                </div>
                {plan ? <Diff plan={plan} /> : null}
                {error ? <Note tone="bad">{error}</Note> : null}
                {msg ? <p role="status">{msg}</p> : null}
              </Block>
              <Block title="Gaps" hint="Every object needs one owner and at least one steward per active slice.">
                <Loaded q={gaps} what="The gaps">
                  {(g) =>
                    g.gaps.length === 0 ? (
                      <StatusWord tone="go">{`No gaps across ${g.objects} objects.`}</StatusWord>
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
      <AdminPage title="Configuration bundle">
        <NeedsPermission what="The configuration bundle" permission="manage_settings" />
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
    <AdminPage title="Configuration bundle" lead="Rules switched on or off, field mappings, waves and their gates, settings, SLA policies and the escalation chain as one JSON file. Move a configuration from a test tenant to production, or keep it under version control.">
      <Block title="Export">
        <button type="button" className="m2-btn" onClick={() => void exportBundle().catch((e) => setError(failureText(e)))}>
          Download the bundle
        </button>
      </Block>
      <Block title="Import" hint="Import adds and changes; it never deletes what the file leaves out. Check the diff first.">
        <FileField
          label="Bundle file"
          accept=".json,application/json"
          onText={(t) => {
            try {
              const b: unknown = JSON.parse(t);
              setBundle(b);
              void check(b);
            } catch {
              setError("The file is not JSON.");
            }
          }}
        />
        {diff ? (
          <div data-testid="bundle-diff">
            <p>{`${diff.totals.add} to add, ${diff.totals.change} to change, ${diff.totals.same} the same, ${diff.totals.kept} kept as they are.`}</p>
            <ul className="m2-diff">
              {Object.entries(diff.sections).flatMap(([section, d]) =>
                d.items
                  .filter((i) => i.change !== "same")
                  .map((i) => (
                    <li key={`${section}-${i.key}`} data-change={i.change}>
                      {`${i.change === "add" ? "Add" : "Change"} ${section.replace(/_/g, " ")}: `}
                      <Mono>{i.key}</Mono>
                    </li>
                  )),
              )}
            </ul>
            <button type="button" className="m2-btn m2-strong" disabled={!diff.dry_run || diff.totals.add + diff.totals.change === 0} onClick={() => void importBundle(bundle, false).then((d) => (setDiff(d), setMsg(`Imported: ${d.totals.add} added, ${d.totals.change} changed.`))).catch((e) => setError(failureText(e)))}>
              Import
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
      <AdminPage title="View as a role">
        <NeedsPermission what="Viewing as a role" permission="manage_users" />
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
    <AdminPage title="View as a role" lead="See the product as one role sees it, to answer a support question or check a role before you grant it. Everything is read-only while you view as a role, and starting and stopping are in the audit log.">
      <Block>
        {session.viewAs ? (
          <Note tone="warn">{`You are viewing as ${ROLE_NAMES[session.viewAs] ?? session.viewAs}. Stop from the bar at the top of the page.`}</Note>
        ) : (
          <div className="m2-adm-acts">
            <label className="m2-fld">
              <span className="m2-lbl">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {VIEW_AS_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NAMES[r] ?? r}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="m2-btn m2-strong" onClick={() => void start()}>
              View as this role
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
      <AdminPage title="Rules import and export">
        <NeedsPermission what="Rules import and export" permission="manage_rules" />
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
    <AdminPage title="Rules import and export" lead="Every rule of the tenant as YAML or Excel, and many rules at once back in. Imported rules are validated against the data dictionary and land as drafts for review, never live.">
      <Block title="Export">
        <div className="m2-adm-acts">
          <select value={fmt} onChange={(e) => setFmt(e.target.value as "yaml" | "xlsx")} aria-label="Format">
            <option value="yaml">YAML</option>
            <option value="xlsx">Excel</option>
          </select>
          <button type="button" className="m2-btn" disabled={!can("export")} onClick={() => void exportRulesBulk(fmt).catch((e) => setError(failureText(e)))}>
            Download the rules
          </button>
        </div>
      </Block>
      <Block title="Import" hint="A YAML list of rules (each with its module), or the Excel sheet the export writes.">
        {can("manage_rules") ? (
          <>
            <FileField label="Rules file (YAML)" accept=".yaml,.yml" onText={(t) => (setFile({ content: t, format: "yaml" }), setResult(null))} />
            <FileField label="Rules file (Excel)" accept=".xlsx" binary onText={(t) => (setFile({ content: t, format: "xlsx" }), setResult(null))} />
            <div className="m2-adm-acts">
              <button type="button" className="m2-btn" disabled={!file} onClick={() => void send(true)}>
                Check the file
              </button>
              <button type="button" className="m2-btn m2-strong" disabled={!result || !result.dry_run || result.valid === 0} onClick={() => void send(false)}>
                {result ? `Create ${result.valid} ${result.valid === 1 ? "draft" : "drafts"}` : "Create drafts"}
              </button>
            </div>
          </>
        ) : (
          <NeedsPermission what="Importing rules" permission="manage_rules" />
        )}
        {result ? (
          <div data-testid="bulk-result">
            <p>{result.dry_run ? `${result.valid} of ${result.total} rules are valid.` : `${result.created.length} drafts created; ${result.invalid} rules were left out.`}</p>
            <ul className="m2-diff">
              {result.rows.map((r) => (
                <li key={r.row} data-change={r.ok ? "add" : "change"}>
                  {`Row ${r.row}${r.id ? ` (${r.id})` : ""}: ${r.ok ? "valid" : r.errors.join("; ")}`}
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
      <AdminPage title="Share links">
        <NeedsPermission what="Every share link of the tenant" permission="manage_users" />
      </AdminPage>
    );
  }
  return (
    <AdminPage title="Share links" lead="Read-only links to one page, opened as a viewer by people of this tenant until they expire. Revoke one and it stops working at once.">
      <Loaded q={q} what="The share links">
        {(d) =>
          d.links.length === 0 ? (
            <p className="m2-meta">Nobody has shared a page yet.</p>
          ) : (
            <ul className="m2-rows" data-testid="share-links">
              {d.links.map((l) => (
                <li key={l.id}>
                  <StatusWord tone={l.state_word === "active" ? "go" : "neutral"}>{l.label ?? l.route}</StatusWord>
                  <span className="m2-meta">{`${l.created_by_label ?? l.created_by}, ${l.state_word === "active" ? `until ${formatDate(l.expires_at, "date")}` : l.state_word}, opened ${int(l.open_count)} ${l.open_count === 1 ? "time" : "times"}`}</span>
                  <Mono>{l.route}</Mono>
                  {l.state_word === "active" ? (
                    <button type="button" className="m2-linkbtn2" onClick={() => void revokeShareLink(l.id).then(() => refreshRoles(qc, "links")).catch((e) => setError(failureText(e)))}>
                      Revoke
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
      <AdminPage title="Out of office">
        <NeedsPermission what="Everyone's out of office" permission="manage_users" />
      </AdminPage>
    );
  }
  return (
    <AdminPage title="Out of office" lead="Who is away and who covers their approvals and assigned work. Each person sets their own from Preferences; an administrator can end one.">
      <Loaded q={q} what="The delegations">
        {(d) =>
          d.delegations.length === 0 ? (
            <p className="m2-meta">Nobody is away.</p>
          ) : (
            <ul className="m2-rows" data-testid="all-delegations">
              {d.delegations.map((x) => (
                <li key={x.id}>
                  <span>{`${x.from_name} to ${x.to_name}`}</span>
                  <span className="m2-meta">{`${x.starts_on} to ${x.ends_on}, ${x.state}`}</span>
                  {x.state === "active" || x.state === "scheduled" ? (
                    <button type="button" className="m2-linkbtn2" onClick={() => void revokeDelegation(x.id).then(() => refreshRoles(qc, "delegations")).catch((e) => setError(failureText(e)))}>
                      End it
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
