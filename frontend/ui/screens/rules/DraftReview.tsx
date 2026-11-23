"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { dryRunDraftBody, publishDraftById, updateDraft } from "@/lib/api/v2/rulelib";
import type { RuleDraft } from "@/lib/api/v2/object";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button, Confirm, Field, Sheet, Stepper, Textarea, useToast } from "@/ui/kit";
import { refreshV2 } from "@/ui/screens/people/common";
import { useCan } from "@/ui/screens/orphans/useCan";
import { compactCount } from "./format";

/** One draft rule: edit it, try it on the data, then publish. Publishing needs the manage_rules permission. */
export function DraftReview({ draft, onClose }: { draft: RuleDraft | null; onClose: () => void }) {
  return (
    <Sheet open={!!draft} onClose={onClose} label={t("Review draft rule")} closeLabel={t("Close")}>
      {draft ? <Body key={draft.id} draft={draft} onClose={onClose} /> : null}
    </Sheet>
  );
}

function Body({ draft, onClose }: { draft: RuleDraft; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const allowed = useCan()("manage_rules");
  const mdl = draft.domain.replace(/^dq_rule:/, "");
  const original = JSON.stringify(draft.proposed_rule, null, 2);
  const [text, setText] = useState(original);
  const [saved, setSaved] = useState(original);
  const [ask, setAsk] = useState(false);
  const fail = (e: unknown) => { setAsk(false); toast(errorSentence(e, t("The change did not go through")), "bad"); };
  const save = useMutation({ mutationFn: () => updateDraft(draft.id, { module: mdl, rule_yaml: text }), onSuccess: () => { setSaved(text); void refreshV2(qc); toast(t("Draft saved"), "good"); }, onError: fail });
  const dry = useMutation({ mutationFn: () => dryRunDraftBody({ module: mdl, rule_yaml: text }), onError: fail });
  const pub = useMutation({ mutationFn: () => publishDraftById(draft.id), onSuccess: () => { setAsk(false); void refreshV2(qc); toast(t("Rule published"), "good"); onClose(); }, onError: fail });
  const dirty = text !== saved;
  const r = dry.data;
  const why = !allowed ? t("You need the manage rules permission to change or publish rules.") : dirty ? t("Save your changes before you publish.") : !r ? t("Try the rule on the data first.") : "";
  const step = ask ? 2 : r && !dirty ? 1 : 0;
  const id = draft.proposed_rule.id ?? draft.id;
  return (
    <div className="mx-col">
      <Stepper label={t("Rule steps")} current={step} steps={[{ id: "edit", label: t("Edit") }, { id: "dry", label: t("Dry run") }, { id: "pub", label: t("Publish") }]} />
      <Field label={t("Rule definition")}><Textarea rows={12} value={text} onChange={(e) => { setText(e.target.value); dry.reset(); }} /></Field>
      <div className="mx-rules-row">
        <Button disabled={!allowed || !dirty || save.isPending} onClick={() => save.mutate()}>{t("Save changes")}</Button>
        <Button disabled={dry.isPending} onClick={() => dry.mutate()}>{t("Try it on the data")}</Button>
      </div>
      {r ? <p role="status">{r.evaluated ? t("{n} of {m} records fail", { n: compactCount(r.hits), m: compactCount(r.population) }) : r.reason}</p> : null}
      <Button variant="primary" disabled={!!why || pub.isPending} onClick={() => setAsk(true)}>{t("Publish")}</Button>
      {why ? <p className="mx-muted">{why}</p> : null}
      <Confirm
        open={ask}
        danger
        title={t("Publish this rule?")}
        confirmLabel={t("Publish rule")}
        cancelLabel={t("Cancel")}
        onCancel={() => setAsk(false)}
        onConfirm={() => pub.mutate()}
      >
        {t("Rule {id} goes live on {mod} and runs on every later analysis. 1 rule is created and this draft is removed.", { id, mod: mdl })}
      </Confirm>
    </div>
  );
}
