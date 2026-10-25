"use client";

/** MDM › Survivorship: which source wins each field when records merge into a golden record. */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, ConfirmDialog, DataTable, ExplorerPage, Input, Mono, PageHeader, Pill, Select, type CellMeta, asyncStateOf, toast } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { getSurvivorshipRules, putSurvivorshipRules, type SurvivorshipRule, type SurvivorshipRuleType } from "@/lib/api/survivorship";
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

/** An edit of one rule: its type and its trusted systems as typed, first wins. */
interface Draft {
  rule_type: SurvivorshipRuleType;
  sources: string;
}

const sourcesOf = (text: string): string[] | null => {
  const list = text.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
};
const draftOf = (r: SurvivorshipRule): Draft => ({ rule_type: r.rule_type, sources: (r.trusted_sources ?? []).join(", ") });
const changed = (r: SurvivorshipRule, d: Draft | undefined) =>
  !!d && (d.rule_type !== r.rule_type || (sourcesOf(d.sources) ?? []).join(",") !== (r.trusted_sources ?? []).join(","));

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
  return <Input aria-label={`Trusted systems for ${rule.field}`} placeholder="ECC, S4H" value={d.sources}
    onChange={(e) => edit(rule, { sources: e.target.value })} />;
}

export default function SurvivorshipPage() {
  const { can } = useRole();
  const editable = can("mdm.write");
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => getSurvivorshipRules() });
  const rules = useMemo(() => q.data?.rules ?? [], [q.data]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [confirming, setConfirming] = useState(false);
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
                {editable && rules.length > 0 && (
                  <Button disabled={edited.length === 0} onClick={() => setConfirming(true)}>Save changes</Button>
                )}
              </>
            }
          />
        }
        state={asyncStateOf(q, () => rules.length === 0, true)}
        emptyProps={{ title: "No survivorship rules", detail: "Until a rule exists for a field, the newest source value wins. You can still pick a value per field when you merge a pair.", action: <Button variant="secondary" render={<Link href="/mdm/golden/merge">Review match pairs</Link>} /> }}
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
    </>
  );
}
