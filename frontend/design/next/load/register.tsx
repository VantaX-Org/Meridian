"use client";

/** Registers the sheet kinds of the clean cycle and the load: cycle, load, approve, templates, decisions. Imported by shell/sheets.ts. */
import { registerSheet } from "../shell/registry";
import { CycleSheet } from "../object/CycleSheet";
import { ApproveFlow } from "../flows/ApproveFlow";
import { LoadPrepareFlow } from "../flows/LoadPrepareFlow";
import { Button, Sheet } from "../kit";
import { t } from "@/lib/v2/i18n";
import { DecisionsPanel } from "./Decisions";
import { TemplatesPanel } from "./TemplatesPanel";
import "./load.css";

export function registerLoadSheets() {
  registerSheet("cycle", ({ id, step, setStep, close, under }) => <CycleSheet id={id} step={step} setStep={setStep} close={close} under={under} />);
  registerSheet("load", ({ id, step, setStep, close, under, open }) => (
    <LoadPrepareFlow id={id} step={step} setStep={setStep} close={close} under={under} setRun={(r) => open({ kind: "load", id: r })} />
  ));
  registerSheet("approve", ({ id, step, setStep, close, under, open }) => (
    <ApproveFlow id={id} step={step} setStep={setStep} close={close} under={under} onLoad={() => open({ kind: "load", id })} />
  ));
  registerSheet("templates", ({ id, close, under, open }) => (
    <Sheet open onClose={close} title={t("Migration templates")} size="large" under={under} secondary={<Button variant="secondary" onClick={close}>{t("Done")}</Button>}>
      <TemplatesPanel module={id} onFill={(sheet) => open({ kind: "decisions", id: `${id}/${encodeURIComponent(sheet)}` })} />
    </Sheet>
  ));
  registerSheet("decisions", ({ id, close, under }) => {
    const k = id.indexOf("/");
    const mod = k < 0 ? id : id.slice(0, k);
    const sheet = k < 0 ? "" : decodeURIComponent(id.slice(k + 1));
    return (
      <Sheet open onClose={close} title={t("Decide the missing columns")} meta={sheet} size="medium" under={under} secondary={<Button variant="secondary" onClick={close}>{t("Done")}</Button>}>
        <DecisionsPanel module={mod} sheet={sheet} />
      </Sheet>
    );
  });
}
registerLoadSheets();
