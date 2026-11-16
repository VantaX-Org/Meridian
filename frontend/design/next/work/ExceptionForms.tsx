"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { createExceptionRule, raiseException } from "@/lib/api/v2/exceptions";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button, useToast } from "../kit";

/** The two create forms of the exceptions screen, rebuilt from design/v2/screens/ExceptionForms.tsx. */

export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const SEV_TEXT: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };

function useLive(perm: (can: (p: string) => boolean) => boolean) {
  const s = useV2Session();
  return !s.shared && !s.viewAs && perm(s.can);
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) => (
  <label className="nx-field">
    {label}
    {children}
    {hint ? <small className="nx-sub">{hint}</small> : null}
  </label>
);

function SevSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select className="nx-input" value={value} onChange={(e) => onChange(e.target.value)}>
      {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_TEXT[s]()}</option>)}
    </select>
  );
}

const BLANK_RAISE = { title: "", category: "", severity: "medium", description: "" };

export function RaiseException() {
  const allowed = useLive((can) => can("analyse") || can("run_process_discovery"));
  const fixture = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [f, setF] = useState(BLANK_RAISE);
  const raise = useMutation({
    mutationFn: () => raiseException({ type: "custom_business", category: f.category.trim(), severity: f.severity, title: f.title.trim(), description: f.description.trim() }),
    onSuccess: () => {
      toast({ text: t("Exception raised."), tone: "good" });
      setF(BLANK_RAISE);
      setShow(false);
      void qc.invalidateQueries({ queryKey: ["exceptions"] });
      void qc.invalidateQueries({ queryKey: ["exception-metrics", fixture] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The exception could not be raised.")), tone: "bad" }),
  });
  if (!allowed) return null;
  if (!show) return <div><Button variant="secondary" icon="plus" data-testid="raise-exception-open" onClick={() => setShow(true)}>{t("Raise exception")}</Button></div>;
  const ok = !!(f.category.trim() && f.title.trim() && f.description.trim());
  return (
    <section className="nx-card nx-ex-sec" aria-label={t("Raise exception")} data-testid="raise-exception">
      <h3>{t("Raise exception")}</h3>
      <form className="nx-ex-form" aria-label={t("Raise an exception")} onSubmit={(e) => { e.preventDefault(); if (ok) raise.mutate(); }}>
        <Field label={t("Title")}><input className="nx-input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label={t("Category")} hint={t("For example pricing or process gap.")}><input className="nx-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label={t("Severity")} hint={t("Sets the SLA: the more severe, the shorter the deadline.")}><SevSelect value={f.severity} onChange={(severity) => setF({ ...f, severity })} /></Field>
        <Field label={t("What happened")}><textarea className="nx-input" rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <span className="nx-row">
          <Button type="submit" variant="primary" size={32} disabled={!ok || raise.isPending}>{raise.isPending ? t("Working…") : t("Raise exception")}</Button>
          <Button variant="quiet" size={32} onClick={() => setShow(false)}>{t("Cancel")}</Button>
        </span>
      </form>
    </section>
  );
}

const BLANK_RULE = { name: "", description: "", rule_type: "custom_business", object_type: "", condition: "", severity: "medium", auto_assign_to: "" };

export function NewExceptionRule() {
  const allowed = useLive((can) => can("manage_rules"));
  const fixture = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [f, setF] = useState(BLANK_RULE);
  const create = useMutation({
    mutationFn: () => {
      const owner = f.auto_assign_to.trim();
      return createExceptionRule({
        name: f.name.trim(), description: f.description.trim(), rule_type: f.rule_type, object_type: f.object_type.trim(), condition: f.condition.trim(), severity: f.severity,
        ...(owner ? { auto_assign_to: owner } : {}),
      });
    },
    onSuccess: () => {
      toast({ text: t("Rule created. It is off until you switch it on."), tone: "good" });
      setF(BLANK_RULE);
      setShow(false);
      void qc.invalidateQueries({ queryKey: ["exception-rules", fixture] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The rule could not be created.")), tone: "bad" }),
  });
  if (!allowed) return null;
  if (!show) return <div><Button size={32} variant="secondary" icon="plus" data-testid="new-rule-open" onClick={() => setShow(true)}>{t("New exception rule")}</Button></div>;
  const ok = !!(f.name.trim() && f.description.trim() && f.object_type.trim() && f.condition.trim());
  return (
    <form className="nx-ex-form" aria-label={t("New exception rule")} data-testid="new-rule" onSubmit={(e) => { e.preventDefault(); if (ok) create.mutate(); }}>
      <Field label={t("Rule")}><input className="nx-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t("What it catches")}><input className="nx-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <Field label={t("Raised by")}>
        <select className="nx-input" value={f.rule_type} onChange={(e) => setF({ ...f, rule_type: e.target.value })}>
          <option value="custom_business">{t("Business process")}</option>
          <option value="sap_transaction">{t("SAP transaction")}</option>
        </select>
      </Field>
      <Field label={t("Object")}><input className="nx-input" value={f.object_type} onChange={(e) => setF({ ...f, object_type: e.target.value })} /></Field>
      <Field label={t("Condition")}><input className="nx-input nx-mono" value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })} /></Field>
      <Field label={t("Severity")}><SevSelect value={f.severity} onChange={(severity) => setF({ ...f, severity })} /></Field>
      <Field label={t("Assign to automatically")} hint={t("Optional. A user id.")}><input className="nx-input" value={f.auto_assign_to} onChange={(e) => setF({ ...f, auto_assign_to: e.target.value })} /></Field>
      <span className="nx-row">
        <Button type="submit" variant="primary" size={32} disabled={!ok || create.isPending}>{create.isPending ? t("Working…") : t("Create rule")}</Button>
        <Button variant="quiet" size={32} onClick={() => setShow(false)}>{t("Cancel")}</Button>
      </span>
    </form>
  );
}
