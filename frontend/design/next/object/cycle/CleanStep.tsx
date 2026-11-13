"use client";

/** Clean: download the cleaning workbook of the open run, fix it in Excel or inside Meridian. */
import { useState } from "react";
import { Button, SegmentedControl, useToast } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { downloadCleaningWorkbook } from "@/lib/api/next/runs";
import { uploadSentence } from "@/lib/api/v2/roundtrip";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import type { ObjectRun } from "../useObjectRun";

type Scope = "failing" | "critical" | "required" | "new";

export function CleanStep({ o }: { o: ObjectRun }) {
  const can = useV2Session().can("export");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<Scope>("failing");
  const since = o.previous?.run_number;
  const scopes: { value: Scope; label: string }[] = [
    { value: "failing", label: t("Everything failing") },
    { value: "critical", label: t("Critical and high") },
    { value: "required", label: t("Required fields only") },
    { value: "new", label: since ? t("Only what is new since run {n}", { n: since }) : t("Only what is new") },
  ];

  const download = async () => {
    if (!o.runId) return;
    setBusy(true);
    try {
      await downloadCleaningWorkbook(o.runId, o.module);
      toast({ text: t("The cleaning workbook of run {n} is downloading.", { n: o.run?.run_number ?? "" }), tone: "good" });
    } catch (e) {
      toast({ text: uploadSentence(e, t("The workbook could not be made.")), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nx-stack" data-testid="clean-step">
      <p>{t("One workbook for run {n}: instructions, a fix template and the failing records. Fix the values in Excel, keep the key columns and the sheet names as they are, and upload it in the next step.", { n: o.run?.run_number ?? "" })}</p>
      <fieldset disabled className="nx-fieldset">
        <legend className="nx-field-label">{t("What goes in the workbook")}</legend>
        <SegmentedControl items={scopes} value={scope} onChange={setScope} label={t("Workbook scope")} />
        <label className="nx-check">
          <input type="checkbox" /> {t("One workbook per owner")}
        </label>
        <p className="nx-muted">{t("Choosing a smaller workbook or one per owner is not offered by the server yet; the workbook holds every failing record.")}</p>
      </fieldset>
      {can ? (
        <Button variant="primary" icon="download" loading={busy} loadingLabel={t("Making the workbook")} disabled={!o.runId} reason={o.runId ? undefined : t("Pull a run first.")} onClick={() => void download()}>
          {t("Download cleaning workbook")}
        </Button>
      ) : (
        <p className="nx-note">{t("Only users with the export right can download the workbook.")}</p>
      )}
      <details className="nx-details" open>
        <summary>{t("What is in the workbook")}</summary>
        <ol data-testid="workbook-contents">
          <li>{t("Instructions: what to fix, step by step, the rule texts, the allowed values and how to upload.")}</li>
          <li>{t("Fix template: the load-format columns, required ones marked, the allowed values and a description beside each field.")}</li>
          <li>{t("Records: every failing record with its current values and the failing rule; the key columns are locked.")}</li>
          <li>{t("A hidden fingerprint sheet, so the upload can check that the workbook belongs to this object and run.")}</li>
        </ol>
      </details>
      <V2Link className="nx-link" href={`/next/o/${o.systemSeg}/${o.moduleSeg}/fixes${o.runId ? `?run=${encodeURIComponent(o.runId)}` : ""}`}>{t("Fix inside Meridian instead")}</V2Link>
    </div>
  );
}
