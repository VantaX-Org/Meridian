"use client";

/** Rules › Dictionary: standard SAP dictionary entries for TABLE.FIELD names. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Field, Input, Mono, Notice, PageHeader } from "@/design";
import { getDdicFields, type DdicField } from "@/lib/api/rules";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { apiErrorMessage, isListFailure } from "@/lib/error";

export default function RuleDictionaryPage() {
  const [text, setText] = useState("");
  const tokens = useMemo(() => text.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean), [text]);
  const names = useMemo(() => tokens.filter((s) => s.split(".").length === 2).slice(0, 100), [tokens]);
  const skipped = tokens.filter((s) => s.split(".").length !== 2);
  const q = useQuery({ queryKey: ["ddic-fields", names], queryFn: () => getDdicFields(names), enabled: names.length > 0 });
  const columns = useMemo<ColumnDef<DdicField>[]>(() => [
    { id: "f", header: "Field", cell: ({ row }) => <Mono>{`${row.original.table}.${row.original.field}`}</Mono> },
    { id: "domain", header: "Domain", cell: ({ row }) => row.original.domain ?? "—" },
    { id: "de", header: "Data element", cell: ({ row }) => row.original.data_element ?? "—" },
    { id: "len", header: "Length", cell: ({ row }) => row.original.length ?? "—" },
    actionColumn((f) => <RowLink href={`/search?q=${encodeURIComponent(`${f.table}.${f.field}`)}`}>Find rules</RowLink>),
  ], []);
  const items = (q.data ?? []).filter((f) => !f.missing);
  const missing = (q.data ?? []).filter((f) => f.missing).map((f) => `${f.table}.${f.field}`);
  return (
    <ExplorerPage
      header={<PageHeader title="Dictionary" meta="Look up what an SAP field holds: its domain, data element and length. Type TABLE.FIELD names, separated by commas." />}
      filterBar={<div className="flex flex-col gap-1"><Field label="Fields"><Input aria-label="Fields" value={text} placeholder="MARA.MATNR, KNA1.KUNNR" onChange={(e) => setText(e.target.value)} /></Field>{skipped.length ? <Notice tone="warning">{`Not TABLE.FIELD, skipped: ${skipped.join(", ")}`}</Notice> : null}{missing.length && items.length ? <Notice tone="info">{`Not in the dictionary: ${missing.join(", ")}`}</Notice> : null}</div>}
      state={names.length === 0 ? "empty" : q.isLoading ? "loading" : isListFailure(q) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={names.length === 0
        ? { title: "No dictionary snapshot yet", detail: "Type TABLE.FIELD names above to look them up in the shipped dictionary.", action: <Button variant="secondary" onClick={() => setText("MARA.MATNR, KNA1.KUNNR")}>Try an example</Button>, ghost: "table" }
        : { title: "Not in the dictionary", detail: `${names.join(", ")} ${names.length === 1 ? "is" : "are"} not in the shipped dictionary. Check the spelling, or connect a system to read its own dictionary.`, action: <Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />, ghost: "table" }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => `${r.table}.${r.field}`} />}
    />
  );
}
