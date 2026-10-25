"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, ConfirmDialog, DataTable, Dialog, ExplorerPage, Field, Input, Mono, PageHeader, Pill, Select, type CellMeta, asyncStateOf, toast } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { TrustedSystemsPicker } from "@/components/mdm/trusted-systems";
import { useRole } from "@/hooks/use-role";
import { getSurvivorshipRules, putSurvivorshipRules, type SurvivorshipRule, type SurvivorshipRuleType } from "@/lib/api/survivorship";
import { getRuleCoverage } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";

const QUERY_KEY = ["mdm", "survivorship"] as const;

/** Each rule type as the sentence a steward would say. */
const RULE_WORDS: Record<SurvivorshipRuleType, string> = {
  most_recent: "Newest value wins",
  most_complete: "Most complete value wins",
  most_frequent: "Most common value wins",
  trusted_source: "Trusted system wins",
  chain: "Trusted systems, in order",
  manual_override: "A steward sets it",
};
const RULE_OPTIONS = (Object.keys(RULE_WORDS) as SurvivorshipRuleType[]).map((value) => ({ value, label: RULE_WORDS[value] }));
/** The rule types that read the trusted systems list (api/services/survivorship.py evaluate_field). */
const USES_SOURCES = new Set<SurvivorshipRuleType>(["trusted_source", "chain"]);

/** An edit of one rule: its type and its trusted systems, first wins. */
interface Draft {
  rule_type: SurvivorshipRuleType;
  sources: string[];
}

const sourcesOf = (list: string[]): string[] | null => (list.length ? list : null);
const draftOf = (r: SurvivorshipRule): Draft => ({ rule_type: r.rule_type, sources: r.trusted_sources ?? [] });
const changed = (r: SurvivorshipRule, d: Draft | undefined) =>
  !!d && (d.rule_type !== r.rule_type || d.sources.join(",") !== (r.trusted_sources ?? []).join(","));

const SourceList = ({ sources }: { sources: string[] | null }) =>
  sources?.length ? <>{sources.map((s, i) => <span key={s}>{i ? ", " : ""}<Mono>{s}</Mono></span>)}</> : <>Any system</>;

/** The edits in progress. Cells read them here so the columns stay stable and an input keeps focus while typing. */
const Drafts = createContext<{ drafts: Record<string, Draft>; edit: (r: SurvivorshipRule, patch: Partial<Draft>) => void }>({
  drafts: {}, edit: () => {},
});

function RuleTypeCell({ rule }: { rule: SurvivorshipRule }) {
  const { drafts, edit } = useContext(Drafts);
  return <Select label={`Which value ${rule.field} keeps`} value={(drafts[rule.id] ?? draftOf(rule)).rule_type} options={RULE_OPTIONS}
    onValueChange={(v) => edit(rule, { rule_type: v as SurvivorshipRuleType })} />;
}

function SourcesCell({ rule }: { rule: SurvivorshipRule }) {
  const { drafts, edit } = useContext(Drafts);
  const d = drafts[rule.id] ?? draftOf(rule);
  if (!USES_SOURCES.has(d.rule_type)) return <SourceList sources={sourcesOf(d.sources)} />;
  return <TrustedSystemsPicker field={rule.field} value={d.sources} onChange={(sources) => edit(rule, { sources })} />;
}

export default function SurvivorshipPage() {
  const { can } = useRole();
  const editable = can("mdm.write");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => getSurvivorshipRules() });
  const rules = useMemo(() => q.data?.rules ?? [], [q.data]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState(false);
  const [adding, setAdding] = useState(false);
  const edited = rules.filter((r) => changed(r, drafts[r.id]));

  const edit = useCallback((r: SurvivorshipRule, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] ?? draftOf(r)), ...patch } })), []);

  const draftContext = useMemo(() => ({ drafts, edit }), [drafts, edit]);

  // PUT replaces a domain's whole rule set: send every rule of each edited domain, edits applied
  const save = useMutation({
    mutationFn: () => Promise.all([...new Set(edited.map((r) => r.domain))].map((domain) =>
      putSurvivorshipRules(domain, rules.filter((r) => r.domain === domain).map((r) => {
        const d = drafts[r.id];
        return { field: r.field, rule_type: d?.rule_type ?? r.rule_type, trusted_sources: d ? sourcesOf(d.sources) : r.trusted_sources,
          weight: r.weight, active: r.active };
      })))),
    onSuccess: () => {
      setConfirming(false);
      setDrafts({});
      toast.success("Survivorship rules saved");
      void qc.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (e) => toast.error("Could not save the survivorship rules", { description: apiErrorMessage(e) }),
  });

  const columns = useMemo<ColumnDef<SurvivorshipRule>[]>(() => [
    { id: "domain", header: "Object", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
    { accessorKey: "field", header: "Field", size: 160, cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    {
      id: "type", header: "Which value is kept", size: 220, accessorFn: (r) => RULE_WORDS[r.rule_type] ?? r.rule_type.replace(/_/g, " "),
      cell: ({ row, getValue }) => (editable ? <RuleTypeCell rule={row.original} /> : String(getValue())),
    },
    {
      id: "sources", header: "Trusted systems, first wins",
      cell: ({ row }) => (editable ? <SourcesCell rule={row.original} /> : <SourceList sources={row.original.trusted_sources} />),
    },
    { accessorKey: "weight", header: "Weight", size: 90, meta: { numeric: true } satisfies CellMeta },
    { id: "active", header: "Status", size: 100, accessorFn: (r) => (r.active ? "Active" : "Off"), cell: ({ row }) => <Pill tone={row.original.active ? "go" : "neutral"}>{row.original.active ? "Active" : "Off"}</Pill> },
    { id: "ai", header: "Set by", cell: ({ row }) => (row.original.ai_inferred ? "Model inference" : "A person") },
    actionColumn((r) => <RowLink href={`/mdm/golden?domain=${encodeURIComponent(r.domain)}`}>Open records</RowLink>),
  ], [editable]);

  return (
    <>
      <ExplorerPage
        header={
          <PageHeader
            title="Survivorship rules"
            meta={`When records merge, these rules decide which value each field keeps. A field without a rule keeps the newest value.${q.data ? ` ${rules.length.toLocaleString()} rules.` : ""}`}
            actions={
              <>
                <Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} />
                {editable ? <Button variant={rules.length ? "secondary" : "primary"} onClick={() => setAdding(true)}>New rule</Button> : null}
                {editable && rules.length > 0 && (
                  <Button disabled={edited.length === 0} onClick={() => setConfirming(true)}>Save changes</Button>
                )}
              </>
            }
          />
        }
        state={asyncStateOf(q, () => rules.length === 0, true)}
        emptyProps={{ title: "No survivorship rules", detail: "Until a rule exists for a field, the newest source value wins. You can still pick a value per field when you merge a pair.",
          action: editable ? <Button onClick={() => setAdding(true)}>New rule</Button> : <Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} /> }}
        errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
        filterBar={editable ? undefined : <p className="m-text-meta m-ink-2">Only master data editors can change survivorship rules</p>}
        table={<Drafts.Provider value={draftContext}><DataTable columns={columns} data={rules} getRowId={(r) => r.id} /></Drafts.Provider>}
      />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Save ${edited.length === 1 ? "1 changed rule" : `${edited.length} changed rules`}?`}
        body="Golden records pick up the new rules when the next analysis run or merge rebuilds them. Until then they keep their current values."
        confirmLabel="Save rules"
        pending={save.isPending}
        onConfirm={() => save.mutate()}
      />
      {adding ? <NewRuleDialog rules={rules} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void qc.invalidateQueries({ queryKey: QUERY_KEY }); }} /> : null}
    </>
  );
}

/**
 * One new rule: object, field, which value is kept and, for the trusted-system types, the systems in order.
 * PUT replaces the object's whole rule set, so the object's stored rules go with it unchanged.
 */
function NewRuleDialog({ rules, onClose, onSaved }: { rules: SurvivorshipRule[]; onClose: () => void; onSaved: () => void }) {
  const coverage = useQuery({ queryKey: ["rule-coverage", "modules"], queryFn: () => getRuleCoverage(), staleTime: 60_000, meta: { ignoreError: true } });
  const objects = [...new Set([...(coverage.data?.objects ?? []).map((o) => o.module), ...rules.map((r) => r.domain)])].sort();
  const [domain, setDomain] = useState("");
  const [field, setField] = useState("");
  const [ruleType, setRuleType] = useState<SurvivorshipRuleType>("most_recent");
  const [sources, setSources] = useState<string[]>([]);
  const name = field.trim().toUpperCase();
  const duplicate = !!domain && !!name && rules.some((r) => r.domain === domain && r.field.toUpperCase() === name);
  const needsSources = USES_SOURCES.has(ruleType) && sources.length === 0;
  const ready = !!domain && !!name && !duplicate && !needsSources;
  const add = useMutation({
    mutationFn: () => putSurvivorshipRules(domain, [
      ...rules.filter((r) => r.domain === domain).map((r) => ({ field: r.field, rule_type: r.rule_type, trusted_sources: r.trusted_sources, weight: r.weight, active: r.active })),
      { field: name, rule_type: ruleType, trusted_sources: USES_SOURCES.has(ruleType) ? sources : null, weight: 50, active: true },
    ]),
    onSuccess: () => { toast.success(`Rule added for ${name}`); onSaved(); },
    onError: (e) => toast.error("Could not add the rule", { description: apiErrorMessage(e) }),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o && !add.isPending) onClose(); }}
      title="New survivorship rule"
      footer={<>
        <Button variant="secondary" disabled={add.isPending} onClick={onClose}>Discard</Button>
        <Button pending={add.isPending} disabled={!ready} onClick={() => add.mutate()}>Add rule</Button>
      </>}
    >
      <div className="flex flex-col gap-3">
        <Field label="Object">
          <Select value={domain} onValueChange={setDomain} placeholder="Choose an object" options={objects.map((d) => ({ value: d, label: formatModuleName(d) }))} />
        </Field>
        <Field label="SAP field" error={duplicate ? `${formatModuleName(domain)} already has a rule for ${name}` : undefined}>
          <Input value={field} onChange={(e) => setField(e.target.value)} placeholder="NAME_ORG1" />
        </Field>
        <Field label="Which value is kept">
          <Select value={ruleType} onValueChange={(v) => setRuleType(v as SurvivorshipRuleType)} options={RULE_OPTIONS} />
        </Field>
        {USES_SOURCES.has(ruleType) ? (
          <div className="flex flex-col gap-1.5">
            <span className="m-field-label">Trusted systems, first wins</span>
            <TrustedSystemsPicker field={name || "the new rule"} value={sources} onChange={setSources} />
            {needsSources ? <p className="m-text-meta m-ink-3">Pick at least one system for this rule type</p> : null}
          </div>
        ) : null}
        <p className="m-text-meta m-ink-3">Golden records pick it up when the next analysis run or merge rebuilds them.</p>
      </div>
    </Dialog>
  );
}
