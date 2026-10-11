"use client";

/** Rules › Dictionary: standard SAP dictionary entries for TABLE.FIELD names. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Field, Mono } from "@/design";
import { getDdicFields, type DdicField } from "@/lib/api/rules";
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
  ], []);
  const items = (q.data ?? []).filter((f) => !f.missing);
  return (
    <ExplorerPage
      filterBar={<div className="flex flex-col gap-1"><Field label="Fields"><input aria-label="Fields" className="rounded border px-3 text-[13px]" style={{ borderColor: "var(--m-line)", height: 40, width: 384 }} value={text} placeholder="MARA.MATNR, KNA1.KUNNR" onChange={(e) => setText(e.target.value)} /></Field>{skipped.length ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{`Not TABLE.FIELD, skipped: ${skipped.join(", ")}`}</p> : null}</div>}
      state={names.length === 0 ? "empty" : q.isLoading ? "loading" : isListFailure(q) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No data dictionary snapshot yet. It is captured during extraction.", detail: "Type TABLE.FIELD names above to look them up in the shipped dictionary.", ghost: "table" }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => `${r.table}.${r.field}`} />}
    />
  );
}
