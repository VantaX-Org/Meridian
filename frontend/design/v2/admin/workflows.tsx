"use client";

import "../approvals.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import { activateDefinition, dryRun, newVersion, type DryRun, type WorkflowDefinition } from "@/lib/api/v2/requests";
import { useDefinitions, useFacts } from "@/lib/v2/requests-queries";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Mono } from "../parts";
import { AdminPage, Block, Confirm, Fld, Loaded, NeedsPermission, Note, StatusWord, Sw, useCan, useDone } from "./kit";

const pretty = (x: unknown): string => JSON.stringify(x, null, 2);

/** Parse a JSON object typed into a field, or say what is wrong with it. */
function parseObject(text: string): { value: Record<string, unknown> } | { error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return { value: v as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { error: tr("This is not a JSON object.") };
}

function Preview({ d }: { d: DryRun }) {
  return (
    <div data-testid="workflow-dry-run">
      {d.problems.length ? (
        <Note tone="bad">{d.problems.join(" ")}</Note>
      ) : (
        <Note>{tr("The definition is valid. With these facts, {n} of {total} steps apply.", { n: int(d.steps.filter((s) => s.applies).length), total: int(d.steps.length) })}</Note>
      )}
      {d.steps.length ? (
        <table className="m2-tbl" aria-label={tr("Steps with these facts")}>
          <thead>
            <tr>
              <th scope="col">{tr("Step")}</th>
              <th scope="col">{tr("Applies")}</th>
              <th scope="col">{tr("Approvers")}</th>
              <th scope="col">{tr("Due within")}</th>
            </tr>
          </thead>
          <tbody>
            {d.steps.map((s) => (
              <tr key={s.index}>
                <td>{s.name}</td>
                <td>{s.applies ? tr("Yes") : tr("No: {reason}", { reason: s.reason ?? "" })}</td>
                <td>{s.assignees.map((a) => a.name).join(", ") || s.assignee_note || "—"}</td>
                <td>{s.sla_hours != null ? tr("{hours} hours", { hours: int(s.sla_hours) }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/** One workflow, its versions, and the editor for the next version with its dry run. */
function Workflow({ versions }: { versions: WorkflowDefinition[] }) {
  const qc = useQueryClient();
  const done = useDone();
  const facts = useFacts();
  const active = versions.find((v) => v.active) ?? versions[versions.length - 1];
  const [text, setText] = useState(() => pretty(active.definition));
  const [sample, setSample] = useState(() => pretty({ value_at_risk: 150000, records: 1, rule_failures: 0 }));
  const [activate, setActivate] = useState(false);
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<WorkflowDefinition | null>(null);
  const def = parseObject(text);
  const fx = parseObject(sample);
  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["v2", "workflow-definitions"] });
      done(label);
    } catch (e) {
      setError(errorSentence(e, tr("The workflow could not be saved.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Block title={active.name} hint={tr("{key} for {kind}", { key: active.key, kind: active.object_kind.replace(/_/g, " ") })}>
      <table className="m2-tbl" aria-label={tr("Versions of {name}", { name: active.name })} data-testid={`workflow-${active.key}`}>
        <thead>
          <tr>
            <th scope="col">{tr("Version")}</th>
            <th scope="col">{tr("State")}</th>
            <th scope="col">{tr("Created")}</th>
            <th scope="col">{tr("Activated")}</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id}>
              <td>
                <Mono>{`v${v.version}`}</Mono>
              </td>
              <td>{v.active ? <StatusWord tone="go">{tr("Active")}</StatusWord> : <StatusWord tone="neutral">{tr("Inactive")}</StatusWord>}</td>
              <td>{`${formatDate(v.created_at, "date")}${v.created_by_label ? `, ${v.created_by_label}` : ""}`}</td>
              <td>{v.activated_at ? `${formatDate(v.activated_at, "date")}${v.activated_by_label ? `, ${v.activated_by_label}` : ""}` : "—"}</td>
              <td>
                {v.active ? null : (
                  <button type="button" className="m2-linkbtn2" disabled={busy} onClick={() => setConfirm(v)}>
                    {tr("Activate")}
                  </button>
                )}
                <button type="button" className="m2-linkbtn2" onClick={() => setText(pretty(v.definition))}>
                  {tr("Edit from this one")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Fld label={tr("Definition of the next version")} hint={facts.data ? tr("Facts a step can test: {facts}. Operators: {ops}.", { facts: Object.keys(facts.data.facts).join(", "), ops: facts.data.ops.join(", ") }) : undefined} error={"error" in def ? def.error : null} wide mono>
        <textarea rows={14} value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} />
      </Fld>
      <Fld label={tr("Sample facts for the dry run")} error={"error" in fx ? fx.error : null} wide mono>
        <textarea rows={4} value={sample} spellCheck={false} onChange={(e) => setSample(e.target.value)} />
      </Fld>
      <Sw checked={activate} onChange={setActivate} label={tr("Activate the new version when saved")} hint={tr("New approvals use the active version; ones already under way keep theirs.")} />
      <div className="m2-adm-acts">
        <button
          type="button"
          className="m2-btn"
          disabled={busy || "error" in def || "error" in fx}
          onClick={() => {
            if ("error" in def || "error" in fx) return;
            setBusy(true);
            setError(null);
            void dryRun(def.value, active.object_kind, fx.value)
              .then(setPreview)
              .catch((e: unknown) => setError(errorSentence(e, tr("The dry run failed."))))
              .finally(() => setBusy(false));
          }}
        >
          {tr("Dry run")}
        </button>
        <button type="button" className="m2-btn m2-strong" disabled={busy || "error" in def} onClick={() => "value" in def && void act(() => newVersion(active.id, def.value, activate), activate ? tr("New version saved and active.") : tr("New version saved."))}>
          {tr("Save as a new version")}
        </button>
      </div>
      {preview ? <Preview d={preview} /> : null}
      {error ? <Note tone="bad">{error}</Note> : null}
      {confirm ? (
        <Confirm
          title={tr("Activate version {version}?", { version: int(confirm.version) })}
          body={tr("New approvals of {kind} follow version {version}. Approvals already under way keep the version they started with.", { kind: confirm.object_kind.replace(/_/g, " "), version: int(confirm.version) })}
          confirm={tr("Activate")}
          pending={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const v = confirm;
            setConfirm(null);
            void act(() => activateDefinition(v.id), tr("Version {version} is active.", { version: int(v.version) }));
          }}
        />
      ) : null}
    </Block>
  );
}

/** /admin/workflows: the approval workflows, their versions, a version editor with a dry run, and activation. */
export function WorkflowsSection() {
  const can = useCan();
  const q = useDefinitions(can("manage_workflows"));
  if (!can("manage_workflows")) {
    return (
      <AdminPage title={tr("Approval workflows")}>
        <NeedsPermission what={tr("Approval workflows")} permission="manage_workflows" />
      </AdminPage>
    );
  }
  return (
    <AdminPage title={tr("Approval workflows")} lead={tr("Who approves fix batches and change requests, in which order, and when a step applies. Each change is a new version; activate one to use it.")}>
      <Loaded q={q} what={tr("The workflows")}>
        {(d) => {
          const keys = [...new Set(d.items.map((x) => x.key))];
          return keys.length === 0 ? (
            <p className="m2-meta">{tr("No workflow is defined.")}</p>
          ) : (
            keys.map((k) => <Workflow key={k} versions={d.items.filter((x) => x.key === k).sort((a, b) => a.version - b.version)} />)
          );
        }}
      </Loaded>
    </AdminPage>
  );
}
