"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/design";
import { Button, Card, ConfirmDialog, ErrorState, Pill, Skeleton } from "@/design";
import { apiErrorDetail, apiErrorState } from "@/lib/error";
import {
  getReferenceLists,
  uploadBicDirectory,
  uploadPostalCodes,
  type ReferenceList,
} from "@/lib/api/system-objects";
import { queryKeys } from "@/lib/query-keys";

const KINDS = [
  {
    kind: "postal-codes",
    upload: uploadPostalCodes,
    unit: "codes",
    name: "postal code list",
    help: "Official postal codes (CSV: country,postcode). Addresses in a listed country are checked against it at the next analysis.",
    error: "Upload failed. Expected a CSV with the columns country and postcode",
  },
  {
    kind: "bic",
    upload: uploadBicDirectory,
    unit: "BICs",
    name: "BIC directory",
    help: "SWIFT BIC directory (CSV, first column: BIC). Bank BICs in a covered country are checked against it at the next analysis.",
    error: "Upload failed. Expected a CSV whose first column is the BIC",
  },
] as const;

/** Licensed reference lists the customer supplies (never read from SAP): postal codes, SWIFT directory. */
export function ReferencePanel({ id }: { id: string }) {
  const q = useQuery({ queryKey: queryKeys.referenceLists(id), queryFn: () => getReferenceLists(id) });
  const lists = q.data ?? [];
  return (
    <Card title="Reference data" meta="Official lists you supply, so addresses and bank codes are checked against the real values">
      <div className="flex flex-col gap-3">
        {q.isLoading ? <Skeleton height={80} /> : null}
        {q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} /> : null}
        {!q.isLoading && !q.isError && KINDS.map((k) => (
          <ReferenceRow key={k.kind} id={id} spec={k} list={lists.find((l) => l.kind === k.kind)} />
        ))}
      </div>
    </Card>
  );
}

function ReferenceRow({ id, spec, list }: { id: string; spec: (typeof KINDS)[number]; list?: ReferenceList }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // A replacement overwrites the loaded list at once, so the picked file waits for a confirmation naming what goes.
  const [replacing, setReplacing] = useState<File | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => spec.upload(id, file),
    onSuccess: (r) => {
      setReplacing(null);
      toast.success(`${r.records.toLocaleString()} ${spec.unit} loaded for ${r.countries.join(", ")}`);
      void qc.invalidateQueries({ queryKey: queryKeys.referenceLists(id) });
    },
    onError: (e) => toast.error(apiErrorDetail(e) ?? spec.error),
  });
  const pick = (f: File) => { if (list) setReplacing(f); else upload.mutate(f); };
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="m-text-body m-ink-2">{spec.help}</p>
      {list ? (
        <Pill tone="go">
          {list.records.toLocaleString()} {spec.unit}, {list.countries.join(", ")}
        </Pill>
      ) : (
        <Pill>None loaded</Pill>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" data-testid={`${spec.kind}-file`}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ""; }} />
      <Button variant="ghost" pending={upload.isPending} onClick={() => input.current?.click()}>
        {list ? "Replace list" : "Upload list"}
      </Button>
      {list ? (
        <ConfirmDialog
          open={!!replacing}
          onOpenChange={(o) => { if (!o) setReplacing(null); }}
          title={`Replace the ${spec.name}`}
          tone="danger"
          body={`The current list of ${list.records.toLocaleString()} ${spec.unit}${list.countries.length ? ` for ${list.countries.join(", ")}` : ""} is replaced by ${replacing?.name ?? "the chosen file"}. The next analysis checks against the new list only.`}
          confirmLabel="Replace list"
          cancelLabel="Keep the current list"
          pending={upload.isPending}
          onConfirm={() => { if (replacing) upload.mutate(replacing); }}
        />
      ) : null}
    </div>
  );
}
