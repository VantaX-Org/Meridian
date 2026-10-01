"use client";

import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, Panel, Stack, Text } from "@/components/aurora";
import { getReferenceLists, uploadPostalCodes } from "@/lib/api/system-objects";

/** Licensed reference lists the customer supplies (never read from SAP), e.g. official postal codes. */
export function ReferencePanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const { data: lists = [] } = useQuery({ queryKey: ["reference", id], queryFn: () => getReferenceLists(id) });
  const upload = useMutation({
    mutationFn: (file: File) => uploadPostalCodes(id, file),
    onSuccess: (r) => {
      toast.success(`${r.records.toLocaleString()} postal codes loaded for ${r.countries.join(", ")}`);
      void qc.invalidateQueries({ queryKey: ["reference", id] });
    },
    onError: () => toast.error("Upload failed — expected a CSV with columns country,postcode"),
  });
  const postal = lists.find((l) => l.kind === "postal-codes");
  return (
    <Panel title="Reference data">
      <Stack direction="row" gap={3} align="center" wrap>
        <Text tone="muted">
          Official postal codes (CSV: country,postcode). Addresses in a listed country are checked against it at the
          next analysis.
        </Text>
        {postal ? (
          <Chip tone="success">
            {postal.records.toLocaleString()} codes · {postal.countries.join(", ")}
          </Chip>
        ) : (
          <Chip>none loaded</Chip>
        )}
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} />
        <Button size="sm" variant="ghost" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {postal ? "Replace list" : "Upload list"}
        </Button>
      </Stack>
    </Panel>
  );
}
