"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { handOffRule, suppressRule } from "@/lib/api/v2/object";
import { setRuleEnabled } from "@/lib/api/v2/rulelib";
import { errorSentence } from "@/lib/api/v2/client";
import { useV2Session } from "@/lib/v2/hooks";
import { useStewards } from "@/lib/v2/object-queries";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, Confirm, useToast } from "../../kit";
import { Note, Sec } from "./work-common";
import type { RuleView } from "./rule";

/** The verbs the viewer's role allows: suppress (approve), edit in authoring (manage_rules), hand to a steward. */

type Panel = "suppress" | "handoff" | null;

function SuppressForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("30");
  const m = useMutation({
    mutationFn: () => suppressRule(view.id, reason.trim(), new Date(Date.now() + Number(days) * 86_400_000).toISOString()),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim().length >= 3) m.mutate();
  };
  return (
    <form className="nx-wk-form" onSubmit={submit} aria-label={t("Suppress {id}", { id: view.id })}>
      <label>
        {t("Reason")}
        <input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={2000} />
      </label>
      <label>
        {t("For")}
        <select value={days} onChange={(e) => setDays(e.target.value)}>
          <option value="30">{t("30 days")}</option>
          <option value="60">{t("60 days")}</option>
          <option value="90">{t("90 days")}</option>
        </select>
      </label>
      <Note>{t("The rule stays out of the score until the date. It takes effect on the next run.")}</Note>
      {m.isError ? <p role="alert" className="nx-wk-alert">{t("The suppression could not be saved.")}</p> : null}
      <div className="nx-ib-acts">
        <Button type="submit" size={32} variant="primary" loading={m.isPending} disabled={m.isPending || reason.trim().length < 3}>
          {t("Suppress rule")}
        </Button>
      </div>
    </form>
  );
}

function HandoffForm({ view, onDone }: { view: RuleView; onDone: () => void }) {
  const stewards = useStewards(true);
  const [who, setWho] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  const mod = view.scope.module ?? view.scope.objects[0]?.module ?? "";
  const m = useMutation({
    mutationFn: () => handOffRule({ check_id: view.id, module: mod, assignee_id: who, note: note.trim(), due_date: due, version_id: view.scope.objects[0]?.run_id }),
    onSuccess: onDone,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (who && note.trim()) m.mutate();
  };
  return (
    <form className="nx-wk-form" onSubmit={submit} aria-label={t("Hand {id} to a steward", { id: view.id })}>
      <label>
        {t("Steward")}
        <select value={who} onChange={(e) => setWho(e.target.value)} required>
          <option value="">{t("Choose")}</option>
          {(stewards.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.email}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Note")}
        <input value={note} onChange={(e) => setNote(e.target.value)} required maxLength={2000} />
      </label>
      <label>
        {t("Due")}
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} required />
      </label>
      {m.isError ? <p role="alert" className="nx-wk-alert">{t("The hand-off could not be created.")}</p> : null}
      <div className="nx-ib-acts">
        <Button type="submit" size={32} variant="primary" loading={m.isPending} disabled={m.isPending || !who || !note.trim()}>
          {t("Hand over")}
        </Button>
      </div>
    </form>
  );
}

export function RuleActions({ view }: { view: RuleView }) {
  const { can } = useV2Session();
  const [panel, setPanel] = useState<Panel>(null);
  const [done, setDone] = useState<string | null>(null);
  const qc = useQueryClient();
  const mod = view.scope.module ?? view.scope.objects[0]?.module ?? "";
  const canSuppress = can("approve");
  const canEdit = can("manage_rules");
  const canHandoff = can("handoff_rule") || can("assign");
  const finish = (msg: string) => {
    setDone(msg);
    setPanel(null);
    void qc.invalidateQueries({ queryKey: ["v2", "rule-scope"] });
  };
  const own = view.scope.tenant_rule;
  const toast = useToast();
  const [confirmOff, setConfirmOff] = useState(false);
  const path = usePathname() ?? "";
  const params = useSearchParams();
  // The drill keeps where it came from: the object page and its run, so the rule page can link back and read the same run.
  const failing = new URLSearchParams({ tab: "failing" });
  if (params?.get("run")) failing.set("run", params.get("run")!);
  if (path.startsWith("/o/")) failing.set("from", path);
  const issues = new URLSearchParams({ rule: view.id });
  if (mod) issues.set("module", mod);
  if (params?.get("system")) issues.set("system", params.get("system")!);
  const flip = useMutation({
    mutationFn: (on: boolean) => setRuleEnabled(own!.id, on),
    onSuccess: (_r, on) => finish(on ? t("{id} is enabled; the next run checks it.", { id: view.id }) : t("{id} is disabled; the next run skips it.", { id: view.id })),
    onError: (e) => toast({ text: errorSentence(e, t("The rule could not be changed.")), tone: "bad" }),
  });
  return (
    <Sec title={t("Actions")}>
      <div className="nx-ib-acts">
        <V2Link href={`/r/${encodeURIComponent(view.id)}`} className="nx-btn nx-btn-primary">
          {t("Open the rule")}
        </V2Link>
        <V2Link href={`/r/${encodeURIComponent(view.id)}?${failing.toString()}`} className="nx-btn" data-testid="rule-failing">
          {t("Open failing records")}
        </V2Link>
        <V2Link href={`/issues?${issues.toString()}`} className="nx-btn" data-testid="rule-issues">
          {t("Open its issues")}
        </V2Link>
        {canSuppress ? (
          <Button size={32} variant="secondary" aria-expanded={panel === "suppress"} onClick={() => setPanel(panel === "suppress" ? null : "suppress")}>
            {t("Suppress")}
          </Button>
        ) : null}
        {canEdit && own ? (
          <Button size={32} variant="secondary" disabled={flip.isPending} aria-pressed={own.enabled} onClick={() => (own.enabled ? setConfirmOff(true) : flip.mutate(true))}>
            {own.enabled ? t("Disable rule") : t("Enable rule")}
          </Button>
        ) : null}
        {canEdit ? (
          <V2Link href={`/rules?view=drafts&module=${encodeURIComponent(mod)}`} className="nx-btn">
            {t("Edit in authoring")}
          </V2Link>
        ) : null}
        {canEdit ? (
          <V2Link href={`/rule-dry-run?rule=${encodeURIComponent(view.id)}&module=${encodeURIComponent(mod)}`} className="nx-btn">
            {t("Dry run")}
          </V2Link>
        ) : null}
        {canHandoff ? (
          <Button size={32} variant="secondary" aria-expanded={panel === "handoff"} onClick={() => setPanel(panel === "handoff" ? null : "handoff")}>
            {t("Hand to a steward")}
          </Button>
        ) : null}
      </div>
      <Confirm
        open={confirmOff && Boolean(own)}
        title={t("Disable rule")}
        consequence={t("Disable {id}? The next run skips it, so its failures stop counting in the score. You can enable it again.", { id: view.id })}
        confirmLabel={t("Disable rule")}
        danger
        onConfirm={() => {
          setConfirmOff(false);
          flip.mutate(false);
        }}
        onCancel={() => setConfirmOff(false)}
      />
      {panel === "suppress" ? <SuppressForm view={view} onDone={() => finish(t("{id} is suppressed until the date you set.", { id: view.id }))} /> : null}
      {panel === "handoff" ? <HandoffForm view={view} onDone={() => finish(t("{id} is handed over; the steward finds it in the inbox.", { id: view.id }))} /> : null}
      {done ? <p role="status" className="nx-ib-meta">{done}</p> : null}
      {!canSuppress && !canEdit && !canHandoff ? <Note>{t("Your role can read this rule. Suppressing, editing and hand-off need a steward, owner or lead role.")}</Note> : null}
    </Sec>
  );
}
