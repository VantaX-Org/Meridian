"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { createExceptionRule, raiseException } from "@/lib/api/v2/exceptions";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Field } from "../forms";
import { useToast } from "../Toast";
import { Panel } from "./Mining";

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEV_TEXT: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

/** Raise an exception by hand (POST /exceptions, needs analyse). A hand-raised exception is a business one; SAP-source ones belong to the monitor. */
export function RaiseException() {
  const { can } = useV2Session();
  const fixture = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const [shown, setShown] = useState(false);
  const blank = { category: "", severity: "medium", title: "", description: "" };
  const [f, setF] = useState(blank);
  const raise = useMutation({
    mutationFn: () => raiseException({ type: "custom_business", category: f.category.trim(), severity: f.severity, title: f.title.trim(), description: f.description.trim() }),
    onSuccess: () => {
      toast.show(t("Exception raised."));
      setF(blank);
      setShown(false);
      void qc.invalidateQueries({ queryKey: ["exceptions"] });
      void qc.invalidateQueries({ queryKey: ["exception-metrics", fixture] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The exception could not be raised.")), "error"),
  });
  if (!can("analyse") && !can("run_process_discovery")) return null;
  if (!shown) return <div className="m2-rfilters"><button type="button" className="m2-btn" data-testid="raise-exception-open" onClick={() => setShown(true)}>{t("Raise exception")}</button></div>;
  const ok = f.category.trim() && f.title.trim() && f.description.trim();
  return (
    <Panel title={t("Raise exception")} testId="raise-exception">
      <form className="m2-rfilters" aria-label={t("Raise an exception")} onSubmit={(e: FormEvent) => { e.preventDefault(); if (ok) raise.mutate(); }}>
        <Field label={t("Title")}>{(p) => <input {...p} className="m2-inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <Field label={t("Category")} hint={t("For example pricing or process gap.")}>{(p) => <input {...p} className="m2-inp" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />}</Field>
        <Field label={t("Severity")} hint={t("Sets the SLA: the more severe, the shorter the deadline.")}>
          {(p) => <select {...p} className="m2-sel" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}</select>}
        </Field>
        <Field label={t("What happened")}>{(p) => <input {...p} className="m2-inp" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        <button type="submit" className="m2-btn m2-next" disabled={!ok || raise.isPending}>{raise.isPending ? t("Working…") : t("Raise exception")}</button>
        <button type="button" className="m2-btn m2-ghost" onClick={() => setShown(false)}>{t("Cancel")}</button>
      </form>
    </Panel>
  );
}

/** Define an exception rule (POST /exceptions/rules, needs manage_rules). The route creates it off; switching it on is the existing toggle. */
export function NewExceptionRule() {
  const { can } = useV2Session();
  const fixture = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const [shown, setShown] = useState(false);
  const blank = { name: "", description: "", rule_type: "custom_business", object_type: "", condition: "", severity: "medium", auto_assign_to: "" };
  const [f, setF] = useState(blank);
  const create = useMutation({
    mutationFn: () => createExceptionRule({
      name: f.name.trim(), description: f.description.trim(), rule_type: f.rule_type, object_type: f.object_type.trim(), condition: f.condition.trim(), severity: f.severity,
      ...(f.auto_assign_to.trim() ? { auto_assign_to: f.auto_assign_to.trim() } : {}),
    }),
    onSuccess: () => {
      toast.show(t("Rule created. It is off until you switch it on."));
      setF(blank);
      setShown(false);
      void qc.invalidateQueries({ queryKey: ["exception-rules", fixture] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The rule could not be created.")), "error"),
  });
  if (!can("manage_rules")) return null;
  if (!shown) return <div className="m2-rfilters"><button type="button" className="m2-btn" data-testid="new-rule-open" onClick={() => setShown(true)}>{t("New exception rule")}</button></div>;
  const ok = f.name.trim() && f.description.trim() && f.object_type.trim() && f.condition.trim();
  return (
    <form className="m2-rfilters" aria-label={t("New exception rule")} data-testid="new-rule" onSubmit={(e: FormEvent) => { e.preventDefault(); if (ok) create.mutate(); }}>
      <Field label={t("Rule")}>{(p) => <input {...p} className="m2-inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
      <Field label={t("What it catches")}>{(p) => <input {...p} className="m2-inp" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
      <Field label={t("Raised by")}>
        {(p) => <select {...p} className="m2-sel" value={f.rule_type} onChange={(e) => setF({ ...f, rule_type: e.target.value })}><option value="custom_business">{t("Business process")}</option><option value="sap_transaction">{t("SAP transaction")}</option></select>}
      </Field>
      <Field label={t("Object")}>{(p) => <input {...p} className="m2-inp" value={f.object_type} onChange={(e) => setF({ ...f, object_type: e.target.value })} />}</Field>
      <Field label={t("Condition")}>{(p) => <input {...p} className="m2-inp" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} />}</Field>
      <Field label={t("Severity")}>
        {(p) => <select {...p} className="m2-sel" value={f.severity} onChange={(e) => setF({ ...f, severity: e.target.value })}>{SEVERITIES.map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}</select>}
      </Field>
      <Field label={t("Assign to automatically")} hint={t("Optional. A user id.")}>{(p) => <input {...p} className="m2-inp" value={f.auto_assign_to} onChange={(e) => setF({ ...f, auto_assign_to: e.target.value })} />}</Field>
      <button type="submit" className="m2-btn m2-next" disabled={!ok || create.isPending}>{create.isPending ? t("Working…") : t("Create rule")}</button>
      <button type="button" className="m2-btn m2-ghost" onClick={() => setShown(false)}>{t("Cancel")}</button>
    </form>
  );
}
