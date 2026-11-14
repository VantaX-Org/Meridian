"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate, formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { getVersionsPage } from "@/lib/api/v2/runs";
import { needsParent, uploadCleaned, uploadSentence, type RoundTripResult } from "@/lib/api/v2/roundtrip";
import { blocks, checkWorkbook, holdReason, worstOf, type UploadCheck } from "@/lib/api/v2/upload-checks";
import { CheckList } from "../object/cycle/UploadStep";
import { checkFile, pool, readMarker, type Marker } from "@/lib/api/next/upload";
import type { PortfolioRow } from "@/lib/api/next/portfolio";
import { Button, Chip, DropZone, SidePanel, type ChipTone } from "../kit";

type Status = "ready" | "needs" | "uploading" | "scoring" | "done" | "failed";

interface Item {
  key: string;
  file: File;
  marker: Marker;
  /** The run the file is the next run of: the marker's, or the one the person picked. */
  parent: string;
  status: Status;
  error?: string;
  result?: RoundTripResult;
  /** What the server says about the file before it is scored; undefined while it is being asked. */
  checks?: UploadCheck[];
  checking?: boolean;
  /** The person accepted the warnings. */
  confirmed?: boolean;
}

const STATUS: Record<Status, [() => string, ChipTone]> = {
  ready: [() => t("Ready"), "neutral"],
  needs: [() => t("Needs a run"), "warn"],
  uploading: [() => t("Uploading"), "accent"],
  scoring: [() => t("Scoring"), "accent"],
  done: [() => t("Done"), "good"],
  failed: [() => t("Failed"), "bad"],
};

/**
 * Several cleaned workbooks at once. Each file names its run in the hidden marker sheet; a file without one (a CSV,
 * a workbook built by hand) waits for the person to pick its run. Uploads go three at a time, and each becomes the
 * next run of its parent, scored at once.
 */
export function UploadPanel({ open, onClose, expected, onDone }: {
  open: boolean;
  onClose: () => void;
  /** The objects the panel was opened for, offered first when a file has no marker. */
  expected: PortfolioRow[];
  onDone: (results: RoundTripResult[]) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const needRuns = items.some((x) => x.status === "needs");
  const runs = useQuery({ queryKey: ["next", "upload-runs"], queryFn: () => getVersionsPage({ limit: 100 }), enabled: open && needRuns });
  const known = new Map(expected.map((r) => [r.version_id, r]));

  const add = async (files: File[]) => {
    const fresh = await Promise.all(
      files.map(async (file, i): Promise<Item> => {
        const key = `${Date.now()}-${i}-${file.name}`;
        const stop = checkFile(file);
        if (stop) return { key, file, marker: {}, parent: "", status: "failed", error: stop };
        const marker = await readMarker(file);
        const only = !marker.version_id && expected.length === 1 ? expected[0].version_id : "";
        const parent = marker.version_id ?? only;
        return { key, file, marker, parent, status: parent ? "ready" : "needs" };
      }),
    );
    setItems((xs) => [...xs, ...fresh]);
    for (const it of fresh) if (it.status === "ready") void verify(it.key, it.file, it.parent);
  };

  /** Ask the server what it thinks of the file; the upload stays off until the answer is in. */
  const verify = async (key: string, file: File, parent: string) => {
    patch(key, { checking: true, checks: undefined, confirmed: false });
    try {
      const r = await checkWorkbook(file, parent);
      patch(key, { checking: false, checks: r.checks });
    } catch (err) {
      patch(key, { checking: false, status: "failed", error: uploadSentence(err, t("The file could not be checked. Try again.")) });
    }
  };
  const goes = (x: Item) => x.status === "ready" && !x.checking && !!x.checks && !blocks(x.checks) && holdReason(x.checks, !!x.confirmed) === null;

  const uploadAll = async () => {
    const todo = items.filter(goes);
    const done: RoundTripResult[] = [];
    setBusy(true);
    await pool(todo, 3, async (it) => {
      patch(it.key, { status: "uploading", error: undefined });
      try {
        const res = await uploadCleaned(it.file, it.parent, !!it.confirmed);
        done.push(res);
        patch(it.key, { status: res.status === "pending" || res.status === "running" ? "scoring" : "done", result: res });
      } catch (err) {
        if (needsParent(err)) patch(it.key, { status: "needs", parent: "" });
        else patch(it.key, { status: "failed", error: uploadSentence(err, t("The file could not be uploaded. Try again.")) });
      }
    });
    setBusy(false);
    if (done.length) onDone(done);
  };

  const ready = items.filter(goes).length;
  const waiting = items.some((x) => x.status === "ready" && !goes(x));
  const runName = (id: string) => {
    const r = known.get(id);
    if (r) return t("Run {n} of {name}", { n: formatInt(r.run_number ?? 0), name: r.label });
    const v = runs.data?.versions.find((x) => x.id === id);
    return v ? t("Run {n}, {date}", { n: formatInt(v.run_number ?? 0), date: formatDate(v.run_at) }) : t("Run {id}", { id: id.slice(0, 8) });
  };
  const close = () => {
    if (busy) return;
    setItems([]);
    onClose();
  };

  return (
    <SidePanel
      open={open}
      onClose={close}
      title={t("Upload cleaned workbooks")}
      footer={
        <>
          <Button variant="primary" icon="upload" loading={busy} loadingLabel={t("Uploading")} disabled={!ready} reason={ready ? undefined : waiting ? t("A workbook is checked, failed or waits for you to confirm its warnings.") : t("Add a workbook that names its run first.")} onClick={() => void uploadAll()}>
            {ready > 1 ? t("Upload all {n}", { n: formatInt(ready) }) : t("Upload")}
          </Button>
          <Button variant="quiet" onClick={close} disabled={busy}>{t("Close")}</Button>
        </>
      }
    >
      <p>{t("Each workbook becomes the next run of the run it came from, and is scored at once.")}</p>
      <DropZone multiple accept=".xlsx,.csv" onFiles={(f) => void add(f)} busy={busy} hint={t("Excel (.xlsx) or CSV, up to 25 MB each.")} label={t("Drop cleaned workbooks here")} />
      <ul className="nx-pf-files" aria-label={t("Workbooks to upload")}>
        {items.map((it) => {
          const [word, tone] = STATUS[it.status];
          return (
            <li key={it.key} className="nx-pf-file" data-testid="upload-row" data-status={it.status}>
              <div className="nx-pf-file-head">
                <span className="nx-mono">{it.file.name}</span>
                <Chip tone={tone}>{word()}</Chip>
              </div>
              {it.marker.module ? <div className="nx-pf-meta"><span className="nx-mono">{it.marker.module}</span>{known.get(it.parent) ? `, ${known.get(it.parent)?.label}` : ""}</div> : null}
              {it.parent && it.status !== "needs" ? <div className="nx-pf-meta">{t("Next run of {run}", { run: runName(it.parent) })}</div> : null}
              {it.status === "needs" ? (
                <label className="nx-field">
                  <span>{t("This file does not say which run it came from. Pick the run.")}</span>
                  <select className="nx-input" value={it.parent} onChange={(e) => { patch(it.key, { parent: e.target.value, status: e.target.value ? "ready" : "needs" }); if (e.target.value) void verify(it.key, it.file, e.target.value); }}>
                    <option value="">{t("Choose a run")}</option>
                    {expected.map((r) => <option key={r.version_id} value={r.version_id}>{`${r.label} (${r.module}), ${runName(r.version_id)}`}</option>)}
                    {(runs.data?.versions ?? []).filter((v) => !known.has(v.id)).map((v) => <option key={v.id} value={v.id}>{`${v.label ?? v.id.slice(0, 8)}, ${runName(v.id)}`}</option>)}
                  </select>
                </label>
              ) : null}
              {it.checking ? <p className="nx-pf-meta" role="status">{t("Checking the workbook")}</p> : null}
              {it.checks ? <CheckList checks={it.checks} /> : null}
              {it.checks && worstOf(it.checks) === "warn" && it.status === "ready" ? (
                <label className="nx-confirm-line">
                  <input type="checkbox" checked={!!it.confirmed} onChange={(e) => patch(it.key, { confirmed: e.target.checked })} data-testid="confirm-warnings" />{" "}
                  {t("Add it with these warnings")}
                </label>
              ) : null}
              {it.error ? <p className="nx-pf-error" role="alert">{it.error}</p> : null}
              {it.result ? <V2Link href={`/run/${it.result.version_id}`}>{t("Open the new run")}</V2Link> : null}
            </li>
          );
        })}
      </ul>
    </SidePanel>
  );
}
