"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Field, Notice, Pill, Textarea, toast } from "@/design";
import { importUsers, previewUserImport, type ImportPreview, type ImportResult } from "@/lib/api/users";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { seatsFullSentence } from "@/lib/users";

const HEADER = "email,name,role,system,module";
const HEADER_WORDS = "email, name, role, system, module";
const MAX_FILE_BYTES = 256 * 1024;

const people = (n: number) => `${n.toLocaleString()} ${n === 1 ? "person" : "people"}`;

/** The seat line under the table: how many the rows need and how many the licence has free. */
function seatLine(s: ImportPreview["seats"]): string {
  if (s.limit == null) return `${people(s.needed)} will take ${s.needed === 1 ? "a seat" : "seats"}. The licence has no seat limit.`;
  return `${people(s.needed)} will take ${s.needed === 1 ? "a seat" : "seats"}. ${s.used.toLocaleString()} of ${s.limit.toLocaleString()} are in use, ${(s.available ?? 0).toLocaleString()} free.`;
}

/**
 * Invite many people from a CSV (email,name,role,system,module). Paste or upload it, read the verdict for every line,
 * then import what passed. Nothing is written until Import; at the seat limit the import is refused with the API's
 * sentence.
 */
export function ImportUsersDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const edit = (next: string) => { setCsv(next); setPreview(null); setResult(null); setRefusal(null); };
  const close = (o: boolean) => { if (!o) { setCsv(""); setPreview(null); setResult(null); setRefusal(null); } onOpenChange(o); };

  const check = useMutation({
    mutationFn: () => previewUserImport(csv),
    onSuccess: (p) => { setPreview(p); setRefusal(null); },
    onError: (e) => { setPreview(null); setRefusal(apiErrorMessage(e)); },
  });
  const commit = useMutation({
    mutationFn: () => importUsers(csv),
    onSuccess: (r) => {
      setResult(r);
      toast.success(`${people(r.created.length)} invited${r.skipped.length ? `, ${r.skipped.length.toLocaleString()} skipped` : ""}`);
      void qc.invalidateQueries({ queryKey: queryKeys.users() });
      void qc.invalidateQueries({ queryKey: queryKeys.licenceManifest() });
    },
    // The API refuses at the seat limit (409) with its own sentence; show it where the seats are shown.
    onError: (e) => setRefusal(apiErrorMessage(e)),
  });

  const pick = async (f: File) => {
    if (f.size > MAX_FILE_BYTES) { setRefusal("That file is over 256 KB. Split it into smaller files."); return; }
    edit(await f.text());
  };

  const seatsRefused = !!preview && !preview.seats.ok;
  const refusalText = refusal ?? (seatsRefused ? seatsFullSentence(preview.seats) : null);

  return (
    <Drawer open={open} onOpenChange={close} title="Import users" subtitle="Invite many people from a CSV file">
      <div className="flex flex-col gap-3">
        <p className="m-text-body m-ink-3">
          One person per line under the header row: {HEADER_WORDS}. Only the email is required. A blank role means Viewer and a blank system means every system.
        </p>
        <Field label="CSV">
          <Textarea rows={6} value={csv} placeholder={`${HEADER}\nana@example.com,Ana Steward,data_steward,,`} onChange={(e) => edit(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" aria-label="CSV file" data-testid="import-file"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f); e.target.value = ""; }} />
          <Button variant="secondary" onClick={() => file.current?.click()}>Upload a CSV file</Button>
          <Button pending={check.isPending} disabled={!csv.trim() || commit.isPending} onClick={() => check.mutate()}>Check the file</Button>
        </div>

        {refusalText ? <Notice tone="danger">{refusalText}</Notice> : null}

        {preview ? (
          <div className="flex flex-col gap-3">
            <p className="m-text-body" data-testid="import-summary">
              {preview.accepted.toLocaleString()} ready, {preview.rejected.toLocaleString()} with a problem
            </p>
            <div className="overflow-x-auto">
              <table className="m-table" aria-label="Import preview">
                <thead>
                  <tr>
                    <th scope="col">Line</th><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Where</th><th scope="col">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line}>
                      <td className="m-numeric">{r.line}</td>
                      <td>{r.email || "Blank"}</td>
                      <td>{r.role || "Viewer"}</td>
                      <td>{[r.system_name ?? (r.system_id ? "One system" : "Every system"), r.module ? formatModuleName(r.module) : null].filter(Boolean).join(", ")}</td>
                      <td>{r.ok ? <Pill tone="go">Ready</Pill> : <span className="flex flex-col items-start gap-1"><Pill tone="no-go">Skipped</Pill><span className="m-text-meta m-ink-3">{r.error}</span></span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-text-body m-ink-3" data-testid="import-seats">{seatLine(preview.seats)}</p>
          </div>
        ) : null}

        {result ? (
          <Notice tone={result.skipped.length ? "warning" : "success"} title={`${people(result.created.length)} invited`}>
            {result.skipped.length ? (
              <ul>{result.skipped.map((s) => <li key={`${s.line}-${s.email}`}>Line {s.line}, {s.email || "blank email"}: {s.error}</li>)}</ul>
            ) : "Each one has an invitation email on its way."}
          </Notice>
        ) : null}

        <div className="flex gap-2">
          {!result ? (
            <Button
              pending={commit.isPending}
              disabled={!preview || preview.accepted === 0 || seatsRefused || commit.isPending}
              onClick={() => commit.mutate()}
            >
              {preview && preview.accepted > 0 ? `Import ${people(preview.accepted)}` : "Import"}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => close(false)}>Close</Button>
        </div>
      </div>
    </Drawer>
  );
}
