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
      <p>{t("The workbook lists every failing record of run {n} with the rule, the field and the value to correct. Fix the values in Excel and upload the workbook in the next step.", { n: o.run?.run_number ?? "" })}</p>
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
      <details className="nx-details">
        <summary>{t("What is in the workbook")}</summary>
        <p>{t("One sheet per table. Each row is a record that fails at least one rule; the failing fields are marked and the rule and its description are beside them. Change only the values; keep the key columns as they are, so Meridian can match each row to its record.")}</p>
      </details>
      <V2Link className="nx-link" href={`/next/o/${o.systemSeg}/${o.moduleSeg}/fixes${o.runId ? `?run=${encodeURIComponent(o.runId)}` : ""}`}>{t("Fix inside Meridian instead")}</V2Link>
    </div>
  );
}
