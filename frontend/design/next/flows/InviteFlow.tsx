"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { t } from "@/lib/v2/i18n";
import { inviteUser } from "@/lib/api/v2/admin";
import { refreshAdmin, useRoles, useScheduleOptions, useUsers } from "@/lib/v2/admin-queries";
import { Button, Sheet, useToast } from "../kit";
import { DraftNote, isSessionError, LongText, useDraft, useSubmitGuard } from "../more/states";
import type { SheetCtx } from "../shell/SheetHost";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INIT = { email: "", name: "", role: "", picked: [] as string[] };

/** Invite a person in three steps: email, role, objects. The draft survives the session ending; a second click is dropped. */
export function InviteFlow({ ctx }: { ctx: SheetCtx }) {
  const { step, setStep, close, under } = ctx;
  const qc = useQueryClient();
  const toast = useToast();
  const roles = useRoles().data ?? [];
  const mods = useScheduleOptions().data?.modules ?? [];
  const existing = useUsers().data?.users ?? [];
  const draft = useDraft("invite", INIT);
  const { email, name, role, picked } = draft.value;
  const guard = useSubmitGuard();
  const [expired, setExpired] = useState(false);
  const [problem, setProblem] = useState("");
  const emailOk = EMAIL.test(email.trim());
  const duplicate = emailOk && existing.some((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  const n = Math.max(1, Math.min(step, 3));

  const send = () =>
    guard.run(async () => {
      setProblem("");
      try {
        const grants = picked.length ? picked.map((module) => ({ role_key: role, module })) : [{ role_key: role }];
        await inviteUser({ email: email.trim(), name: name.trim() || undefined, grants });
        await refreshAdmin(qc, "users");
        draft.clear();
        toast({ text: t("Invite sent."), tone: "good" });
        close();
      } catch (e) {
        if (isSessionError(e)) setExpired(true);
        else if (isAxiosError(e) && e.response?.status === 409) setProblem(t("This email already has an account."));
        else setProblem(t("The invite could not be sent."));
      }
    });

  const steps = [{ id: "email", label: t("Email") }, { id: "role", label: t("Role") }, { id: "objects", label: t("Objects") }];
  const primary =
    n === 1 ? <Button variant="primary" disabled={!emailOk || duplicate} reason={duplicate ? t("This email already has an account.") : t("Enter a valid email address.")} onClick={() => setStep(2)}>{t("Next")}</Button>
    : n === 2 ? <Button variant="primary" disabled={!role} reason={t("Pick a role first.")} onClick={() => setStep(3)}>{t("Next")}</Button>
    : <Button variant="primary" loading={guard.busy} loadingLabel={t("Sending")} onClick={send}>{t("Send invite")}</Button>;

  return (
    <Sheet open onClose={close} title={t("Invite a person")} size="medium" steps={steps} step={n} onStep={(i) => (i < n ? setStep(i) : undefined)} dirty={!!email} primary={primary} under={under}>
      <DraftNote expired={expired} restored={draft.restored} />
      {problem ? <p className="nx-note" role="alert">{problem}</p> : null}
      {n === 1 ? (
        <div className="nx-form">
          <label className="nx-field">{t("Email")}<input className="nx-input" type="email" autoComplete="off" data-autofocus value={email} onChange={(e) => draft.set({ email: e.target.value })} /></label>
          {duplicate ? <p className="nx-note" role="alert">{t("This email already has an account.")}</p> : null}
          <label className="nx-field">{t("Name")}<input className="nx-input" autoComplete="off" value={name} onChange={(e) => draft.set({ name: e.target.value })} /></label>
        </div>
      ) : n === 2 ? (
        <div role="radiogroup" aria-label={t("Role")} className="nx-pick">
          {roles.map((r) => (
            <label key={r.key} className="nx-check"><input type="radio" name="nx-invite-role" checked={role === r.key} onChange={() => draft.set({ role: r.key })} /><LongText text={r.name} />{r.description ? <span className="nx-sub"> {r.description}</span> : null}</label>
          ))}
        </div>
      ) : (
        <div>
          <p>{t("Leave all unticked to give the role on every object.")}</p>
          <ul className="nx-pick" aria-label={t("Objects")}>
            {mods.map((m) => (
              <li key={m}><label className="nx-check"><input type="checkbox" checked={picked.includes(m)} onChange={(e) => draft.set({ picked: e.target.checked ? [...picked, m] : picked.filter((x) => x !== m) })} />{m}</label></li>
            ))}
          </ul>
        </div>
      )}
    </Sheet>
  );
}
