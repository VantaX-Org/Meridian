"use client";

/** Rules › Drafts: the editor for one draft, or a new one. A draft is only ever saved here; Publish creates the rule. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button, ConfirmDialog, DataTable, Drawer, Field, Input, Mono, Notice, Select, Stat } from "@/design";
import {
  createRuleDraft, deleteRuleDraft, dryRunRuleDraft, generateRuleDraft, publishRuleDraft, updateRuleDraft,
  type RuleDraftDryRun,
} from "@/lib/api/rule-authoring";
import { getRuleCoverage, type RuleDraft } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import {
  CHECK_CLASSES, DIMENSIONS, EMPTY_FORM, SEVERITIES, formToBody, ruleToForm, validateForm, type DraftForm,
} from "./draft-model";

const toOptions = (values: readonly string[]) => values.map((value) => ({ value, label: labelOf(value) }));

function DryRunResult({ result }: { result: Extract<RuleDraftDryRun, { evaluated: true }> }) {
  const columns = useMemo<ColumnDef<Record<string, string>>[]>(() => {
    const keys = [...new Set(result.sample.flatMap((r) => Object.keys(r)))];
    return keys.map((k) => ({ id: k, header: k, cell: ({ row }) => <Mono>{row.original[k] ?? "—"}</Mono> }));
  }, [result.sample]);
  return (
    <div className="flex flex-col gap-3" data-testid="dry-run-result">
      <div className="m-stat-grid">
        <Stat label="Rows matched" value={result.hits.toLocaleString()} />
        <Stat label="Rows checked" value={result.population.toLocaleString()} />
        <Stat label="Pass rate" value={`${(result.pass_rate * (result.pass_rate <= 1 ? 100 : 1)).toFixed(1)} %`} />
      </div>
      {result.sample.length > 0 ? (
        <DataTable columns={columns} data={result.sample} getRowId={(r) => JSON.stringify(r)} hideToolbar dense height="auto" tableId="rule-draft-dry-run-sample" />
      ) : null}
    </div>
  );
}

export function DraftDrawer({ draft, open, onOpenChange }: { draft: RuleDraft | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient();
  const initialModule = draft ? draft.domain.replace("dq_rule:", "") : "";
  const [form, setForm] = useState<DraftForm>(() => (draft ? ruleToForm(draft.proposed_rule, initialModule) : EMPTY_FORM));
  const [rationale, setRationale] = useState(draft?.rationale ?? "");
  const [prompt, setPrompt] = useState("");
  const [aiErrors, setAiErrors] = useState<string[] | null>(null);
  const [fromAi, setFromAi] = useState(false);
  const [dirty, setDirty] = useState(!draft);
  const [dryRun, setDryRun] = useState<RuleDraftDryRun | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const coverage = useQuery({ queryKey: ["rule-coverage", "modules"], queryFn: () => getRuleCoverage(), staleTime: 60_000 });
  const moduleOptions = useMemo(() => {
    const modules = new Set((coverage.data?.objects ?? []).map((o) => o.module));
    if (form.module) modules.add(form.module);
    return [...modules].sort().map((value) => ({ value, label: formatModuleName(value) }));
  }, [coverage.data, form.module]);

  const errors = validateForm(form);
  const valid = Object.keys(errors).length === 0;
  const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setDryRun(null);
  };
  const refreshDrafts = () => qc.invalidateQueries({ queryKey: ["rule-drafts"] });
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));

  const generate = useMutation({
    mutationFn: () => generateRuleDraft({ module: form.module.trim(), description: prompt.trim() }),
    onSuccess: (g) => {
      setForm(ruleToForm(g.rule, form.module));
      setFromAi(true);
      setDirty(true);
      setDryRun(null);
      setAiErrors(g.valid ? null : g.errors);
      toast.success(g.valid ? "Draft generated. Review it, dry run it, then save" : "Draft generated with problems to fix");
    },
    onError: fail,
  });
  const run = useMutation({
    mutationFn: () => dryRunRuleDraft(formToBody(form)),
    onSuccess: (r) => setDryRun(r),
    onError: fail,
  });
  const save = useMutation({
    mutationFn: () => (draft ? updateRuleDraft(draft.id, formToBody(form, rationale || undefined)) : createRuleDraft(formToBody(form, rationale || undefined))),
    onSuccess: () => { toast.success(draft ? "Draft saved" : "Draft created"); setDirty(false); refreshDrafts(); onOpenChange(false); },
    onError: fail,
  });
  const publish = useMutation({
    mutationFn: () => publishRuleDraft((draft as RuleDraft).id),
    onSuccess: (r) => { toast.success(`Rule ${r.name.split(":")[0]} is active from the next run`); refreshDrafts(); qc.invalidateQueries({ queryKey: ["rules"] }); onOpenChange(false); },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => deleteRuleDraft((draft as RuleDraft).id),
    onSuccess: () => { toast.success("Draft deleted"); setConfirmDelete(false); refreshDrafts(); onOpenChange(false); },
    onError: fail,
  });

  const guard = (fn: () => void) => () => { if (!valid) { setShowErrors(true); return; } fn(); };
  const shown = (k: keyof DraftForm) => (showErrors ? errors[k] : undefined);

  return (
    <>
      <Drawer
        open={open}
        onOpenChange={onOpenChange}
        title={draft ? "Edit draft" : "New draft"}
        subtitle={draft ? <Mono>{String(draft.proposed_rule.id ?? draft.id)}</Mono> : "Saved as a draft, never published directly"}
        footer={
          <>
            {draft ? <Button variant="ghost" onClick={() => setConfirmDelete(true)}>Delete draft</Button> : null}
            <Button variant="secondary" onClick={guard(() => run.mutate())} pending={run.isPending}>Dry run</Button>
            {draft ? (
              <Button variant="secondary" onClick={() => publish.mutate()} pending={publish.isPending} disabled={dirty}>Publish rule</Button>
            ) : null}
            <Button onClick={guard(() => save.mutate())} pending={save.isPending}>{draft ? "Save draft" : "Create draft"}</Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {!draft ? (
            <div className="flex flex-col gap-2" data-testid="generate-with-ai">
              <Field label="Describe the rule">
                <textarea className="m-input m-textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Vendors in Germany must have a VAT registration number" />
              </Field>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => generate.mutate()}
                  pending={generate.isPending}
                  disabled={prompt.trim().length < 5 || !form.module.trim()}
                >
                  <Sparkles size={14} aria-hidden /> Generate with AI
                </Button>
                {!form.module.trim() ? <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>Choose an object first</span> : null}
              </div>
            </div>
          ) : null}
          {fromAi ? (
            <Notice tone="info" title="AI-drafted rule">
              The model saw field metadata and aggregate statistics only, never record values. Review it and dry run it. It is not published until you publish it.
              {aiErrors && aiErrors.length > 0 ? <ul className="mt-1 list-disc pl-4">{aiErrors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </Notice>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rule id" error={shown("id")}><Input value={form.id} onChange={(e) => set("id", e.target.value)} /></Field>
            <Field label="Object" error={shown("module")}>
              <Select value={form.module} onValueChange={(v) => set("module", v)} options={moduleOptions} placeholder="Choose an object" />
            </Field>
            <Field label="Field"><Input value={form.field} onChange={(e) => set("field", e.target.value)} placeholder="TABLE.FIELD" /></Field>
            <Field label="Check class"><Select value={form.check_class} onValueChange={(v) => set("check_class", v)} options={toOptions(CHECK_CLASSES)} /></Field>
            <Field label="Severity"><Select value={form.severity} onValueChange={(v) => set("severity", v)} options={toOptions(SEVERITIES)} /></Field>
            <Field label="Dimension"><Select value={form.dimension} onValueChange={(v) => set("dimension", v)} options={toOptions(DIMENSIONS)} /></Field>
          </div>
          <Field label="Message" error={shown("message")}><Input value={form.message} onChange={(e) => set("message", e.target.value)} /></Field>
          <Field label="Conditions (JSON)" error={shown("conditions")}>
            <textarea className="m-input m-textarea" rows={8} value={form.conditions} onChange={(e) => set("conditions", e.target.value)} spellCheck={false} style={{ fontFamily: "var(--m-font-mono)" }} />
          </Field>
          <Field label="Why this rule"><Input value={rationale} onChange={(e) => { setRationale(e.target.value); setDirty(true); }} /></Field>

          {dryRun ? (
            dryRun.evaluated ? <DryRunResult result={dryRun} /> : <Notice tone="warning" title="The dry run did not evaluate">{dryRun.reason}</Notice>
          ) : null}
        </div>
      </Drawer>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this draft"
        body="The draft is removed for everyone. Published rules are not affected."
        confirmLabel="Delete draft"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
