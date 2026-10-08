"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, Panel, Stack, Text } from "@/components/aurora";
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
    help: "Official postal codes (CSV: country,postcode). Addresses in a listed country are checked against it at the next analysis.",
    error: "Upload failed — expected a CSV with columns country,postcode",
  },
  {
    kind: "bic",
    upload: uploadBicDirectory,
    unit: "BICs",
    help: "SWIFT BIC directory (CSV, first column: BIC). Bank BICs in a covered country are checked against it at the next analysis.",
    error: "Upload failed — expected a CSV whose first column is the BIC",
  },
] as const;

/** Licensed reference lists the customer supplies (never read from SAP): postal codes, SWIFT directory. */
export function ReferencePanel({ id }: { id: string }) {
  const { data: lists = [] } = useQuery({ queryKey: queryKeys.referenceLists(id), queryFn: () => getReferenceLists(id) });
  return (
    <Panel title="Reference data">
      <Stack gap={3}>
        {KINDS.map((k) => (
          <ReferenceRow key={k.kind} id={id} spec={k} list={lists.find((l) => l.kind === k.kind)} />
        ))}
      </Stack>
    </Panel>
  );
}

function ReferenceRow({ id, spec, list }: { id: string; spec: (typeof KINDS)[number]; list?: ReferenceList }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => spec.upload(id, file),
    onSuccess: (r) => {
      toast.success(`${r.records.toLocaleString()} ${spec.unit} loaded for ${r.countries.join(", ")}`);
      void qc.invalidateQueries({ queryKey: queryKeys.referenceLists(id) });
    },
    onError: () => toast.error(spec.error),
  });
  return (
    <Stack direction="row" gap={3} align="center" wrap>
      <Text tone="muted">{spec.help}</Text>
      {list ? (
        <Chip tone="success">
          {list.records.toLocaleString()} {spec.unit}, {list.countries.join(", ")}
        </Chip>
      ) : (
        <Chip>none loaded</Chip>
      )}
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
      <Button size="sm" variant="ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
        {list ? "Replace list" : "Upload list"}
      </Button>
    </Stack>
  );
}
