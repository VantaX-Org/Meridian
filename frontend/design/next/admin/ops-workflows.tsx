"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import { activateDefinition, createDefinition, dryRun, getDefinition, newVersion, type DryRun, type WorkflowDefinition } from "@/lib/api/v2/requests";
import { useDefinitions, useFacts } from "@/lib/v2/requests-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { int } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Button, Chip, Code, Confirm, DataTable, EmptyState, Sheet, Skeleton, ErrorState, useToast } from "../kit";
import { Denied } from "../more/states";
import { OpsBlock, OpsLoaded, OpsPage } from "./ops-kit";

const pretty = (x: unknown): string => JSON.stringify(x, null, 2);
const kindWords = (k: string) => k.replace(/_/g, " ");

/** Parse a JSON object typed into a field, or say what is wrong with it. */
function parseObject(text: string): { value: Record<string, unknown> } | { error: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return { value: v as Record<string, unknown> };
  } catch {
    // fall through
  }
  return { error: t("This is not a JSON object.") };
}

function Bad({ children }: { children: string }) {
  return <p className="nx-note nx-ops-bad" role="alert">{children}</p>;
}

function JsonField({ label, hint, value, onChange, rows, error }: { label: string; hint?: string; value: string; onChange: (v: string) => void; rows: number; error: string | null }) {
  return (
    <label className="nx-field">
      <span>{label}</span>
      <textarea className="nx-input nx-ops-pre" rows={rows} value={value} spellCheck={false} aria-invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="nx-sub">{hint}</span> : null}
      {error ? <span className="nx-ops-bad" role="alert">{error}</span> : null}
    </label>
  );
}

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="nx-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="nx-sub"> {hint}</span> : null}
      </span>
    </label>
  );
}

function Preview({ d }: { d: DryRun }) {
  return (
    <div data-testid="workflow-dry-run">
      {d.problems.length ? <Bad>{d.problems.join(" ")}</Bad> : <p className="nx-note" role="status">{t("The definition is valid. With these facts, {n} of {total} steps apply.", { n: int(d.steps.filter((s) => s.applies).length), total: int(d.steps.length) })}</p>}
      {d.steps.length ? (
        <DataTable
          caption={t("Steps with these facts")}
          rows={d.steps}
          rowKey={(s) => String(s.index)}
          rowLabel={(s) => s.name}
          columns={[
            { id: "step", label: t("Step"), cell: (s) => s.name },
            { id: "applies", label: t("Applies"), cell: (s) => (s.applies ? t("Yes") : t("No: {reason}", { reason: s.reason ?? "" })) },
            { id: "who", label: t("Approvers"), cell: (s) => s.assignees.map((a) => a.name).join(", ") || s.assignee_note || "—" },
            { id: "due", label: t("Due within"), cell: (s) => (s.sla_hours != null ? t("{hours} hours", { hours: int(s.sla_hours) }) : "—") },
          ]}
        />
      ) : null}
    </div>
  );
}

/** One stored version, read from GET /workflows/definitions/{id}: the definition exactly as the engine holds it. */
function DefinitionDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["v2", "workflow-definition", id], queryFn: () => getDefinition(id as string), enabled: !!id, retry: false });
  return (
    <Sheet open={!!id} onClose={onClose} title={q.data ? q.data.name : t("Open")} size="medium">
      <div data-testid="workflow-definition">
        {q.isError ? <ErrorState sentence={errorSentence(q.error, t("The workflow version could not be opened."))} onRetry={() => void q.refetch()} /> : null}
        {q.isPending && id ? <Skeleton lines={6} /> : null}
        {q.data ? (
          <>
            <p className="nx-sub">{t("Version {version}, {state}", { version: int(q.data.version), state: q.data.active ? t("Active") : t("Inactive") })}</p>
            {q.data.description ? <p>{q.data.description}</p> : null}
            <pre className="nx-ops-pre">{pretty(q.data.definition)}</pre>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

function Workflow({ versions }: { versions: WorkflowDefinition[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const facts = useFacts();
  const active = versions.find((v) => v.active) ?? versions[versions.length - 1];
  const [text, setText] = useState(() => pretty(active.definition));
  const [sample, setSample] = useState(() => pretty({ value_at_risk: 150000, records: 1, rule_failures: 0 }));
  const [activate, setActivate] = useState(false);
  const [preview, setPreview] = useState<DryRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<WorkflowDefinition | null>(null);
  const [view, setView] = useState<string | null>(null);
  const def = parseObject(text);
  const fx = parseObject(sample);
  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["v2", "workflow-definitions"] });
      toast({ tone: "good", text: label });
    } catch (e) {
      setError(errorSentence(e, t("The workflow could not be saved.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <OpsBlock title={active.name} hint={t("{key} for {kind}", { key: active.key, kind: kindWords(active.object_kind) })} testid={`workflow-${active.key}`}>
      <DataTable
        caption={t("Versions of {name}", { name: active.name })}
        rows={versions}
        rowKey={(v) => v.id}
        rowLabel={(v) => `v${v.version}`}
        columns={[
          { id: "version", label: t("Version"), cell: (v) => <Code code={`v${v.version}`} />, compare: (a, b) => a.version - b.version },
          { id: "state", label: t("State"), cell: (v) => (v.active ? <Chip tone="good">{t("Active")}</Chip> : <Chip tone="neutral">{t("Inactive")}</Chip>) },
          { id: "created", label: t("Created"), cell: (v) => `${formatDate(v.created_at, "date")}${v.created_by_label ? `, ${v.created_by_label}` : ""}` },
          { id: "activated", label: t("Activated"), cell: (v) => (v.activated_at ? `${formatDate(v.activated_at, "date")}${v.activated_by_label ? `, ${v.activated_by_label}` : ""}` : "—") },
          {
            id: "acts",
            label: t("Actions"),
            cell: (v) => (
              <span className="nx-ops-actions">
                {v.active ? null : <Button size={32} variant="quiet" disabled={busy} onClick={() => setConfirm(v)}>{t("Activate")}</Button>}
                <Button size={32} variant="quiet" aria-label={t("Open version {version}", { version: int(v.version) })} onClick={() => setView(v.id)}>{t("Open")}</Button>
                <Button size={32} variant="quiet" onClick={() => setText(pretty(v.definition))}>{t("Edit from this one")}</Button>
              </span>
            ),
          },
        ]}
      />
      <DefinitionDetail id={view} onClose={() => setView(null)} />
      <div className="nx-ops-form">
        <JsonField label={t("Definition of the next version")} hint={facts.data ? t("Facts a step can test: {facts}. Operators: {ops}.", { facts: Object.keys(facts.data.facts).join(", "), ops: facts.data.ops.join(", ") }) : undefined} rows={14} value={text} onChange={setText} error={"error" in def ? def.error : null} />
        <JsonField label={t("Sample facts for the dry run")} rows={4} value={sample} onChange={setSample} error={"error" in fx ? fx.error : null} />
        <Check checked={activate} onChange={setActivate} label={t("Activate the new version when saved")} hint={t("New approvals use the active version; ones already under way keep theirs.")} />
      </div>
      <div className="nx-ops-actions">
        <Button
          disabled={busy || "error" in def || "error" in fx}
          onClick={() => {
            if ("error" in def || "error" in fx) return;
            setBusy(true);
            setError(null);
            void dryRun(def.value, active.object_kind, fx.value)
              .then(setPreview)
              .catch((e: unknown) => setError(errorSentence(e, t("The dry run failed."))))
              .finally(() => setBusy(false));
          }}
        >
          {t("Dry run")}
        </Button>
        <Button variant="primary" disabled={busy || "error" in def} onClick={() => "value" in def && void act(() => newVersion(active.id, def.value, activate), activate ? t("New version saved and active.") : t("New version saved."))}>
          {t("Save as a new version")}
        </Button>
      </div>
      {preview ? <Preview d={preview} /> : null}
      {error ? <Bad>{error}</Bad> : null}
      <Confirm
        open={!!confirm}
        title={confirm ? t("Activate version {version}?", { version: int(confirm.version) }) : ""}
        consequence={confirm ? t("New approvals of {kind} follow version {version}. Approvals already under way keep the version they started with.", { kind: kindWords(confirm.object_kind), version: int(confirm.version) }) : ""}
        confirmLabel={t("Activate")}
        blocked={busy ? t("Working…") : undefined}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const v = confirm;
          if (!v) return;
          setConfirm(null);
          void act(() => activateDefinition(v.id), t("Version {version} is active.", { version: int(v.version) }));
        }}
      />
    </OpsBlock>
  );
}

const starter = () => ({ steps: [{ name: t("Data owner approves"), assignee: { rule: "data_owner" }, quorum: "any", sla_hours: 48, requester_may_approve: false }] });

/** A new workflow: its name, what it approves, and version 1 of its definition. */
function NewWorkflow() {
  const qc = useQueryClient();
  const toast = useToast();
  const facts = useFacts();
  const kinds = facts.data?.object_kinds ?? ["change_request", "fix_batch"];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState(kinds[0]);
  const [text, setText] = useState(() => pretty(starter()));
  const [activate, setActivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const def = parseObject(text);
  const dirty = !!name || !!description;
  const create = async () => {
    if ("error" in def) return;
    setBusy(true);
    setError(null);
    try {
      await createDefinition({ name: name.trim(), description: description.trim() || null, object_kind: kind, definition: def.value, activate });
      await qc.invalidateQueries({ queryKey: ["v2", "workflow-definitions"] });
      toast({ tone: "good", text: t("Workflow {name} created.", { name: name.trim() }) });
      setOpen(false);
      setName("");
      setDescription("");
    } catch (e) {
      setError(errorSentence(e, t("The workflow could not be saved.")));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>{t("New workflow")}</Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("New workflow")}
        meta={t("Saved as version 1. Activate it to use it for new approvals.")}
        size="medium"
        dirty={dirty}
        secondary={<Button disabled={busy} onClick={() => setOpen(false)}>{t("Cancel")}</Button>}
        primary={<Button variant="primary" loading={busy} disabled={!name.trim() || "error" in def} onClick={() => void create()}>{t("Create workflow")}</Button>}
      >
        <div className="nx-ops-form">
          <label className="nx-field">
            <span>{t("Name")}</span>
            <input className="nx-input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="nx-field">
            <span>{t("What it approves")}</span>
            <select className="nx-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              {kinds.map((k) => (
                <option key={k} value={k}>{kindWords(k)}</option>
              ))}
            </select>
          </label>
          <label className="nx-field">
            <span>{t("Description")}</span>
            <input className="nx-input" value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <JsonField label={t("Definition")} rows={10} value={text} onChange={setText} error={"error" in def ? def.error : null} />
          <Check checked={activate} onChange={setActivate} label={t("Activate it when saved")} />
          {error ? <Bad>{error}</Bad> : null}
        </div>
      </Sheet>
    </>
  );
}

/** Admin > Approval workflows: the workflows, their versions, a version editor with a dry run, and activation. */
export function OpsWorkflows() {
  const { can } = useV2Session();
  const q = useDefinitions(can("manage_workflows"));
  if (!can("manage_workflows")) return <Denied what={t("Approval workflows")} />;
  return (
    <OpsPage lead={t("Who approves fix batches and change requests, in which order, and when a step applies. Each change is a new version; activate one to use it.")} actions={<NewWorkflow />}>
      <OpsLoaded q={q} what={t("The workflows")}>
        {(d) => {
          const keys = [...new Set(d.items.map((x) => x.key))];
          return keys.length === 0 ? (
            <EmptyState heading={t("No workflow is defined.")} />
          ) : (
            keys.map((k) => <Workflow key={k} versions={d.items.filter((x) => x.key === k).sort((a, b) => a.version - b.version)} />)
          );
        }}
      </OpsLoaded>
    </OpsPage>
  );
}
