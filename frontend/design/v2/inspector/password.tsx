"use client";

/**
 * Password actions: the admin's Set a password dialog (typed, or generated and shown once) and the self-service
 * Change your password block in Preferences. Local sign-in only: under enforced single sign-on a non-admin's
 * password is managed by the identity provider, so both say so and offer nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { getOidcPublicConfig } from "@/lib/api/sso";
import { errorSentence } from "@/lib/api/v2/client";
import { fixtureActive } from "@/lib/api/v2/fixture";
import * as api from "@/lib/api/v2/admin";
import { t } from "@/lib/v2/i18n";
import { MIN_PASSWORD_LENGTH } from "../auth/SetPassword";
import { Dialog, copyText } from "../admin/kit";
import { ResultFrame, useOutcome, type Outcome } from "./shared";

/** True when the tenant enforces single sign-on (public config, so any signed-in user can read it). */
export function useSsoEnforced(): boolean {
  const q = useQuery({
    queryKey: ["oidc-public", fixtureActive()],
    queryFn: () => (fixtureActive() ? Promise.resolve({ enabled: false, display_name: null, enforce: false }) : getOidcPublicConfig()),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return Boolean(q.data?.enabled && q.data.enforce);
}

/** The sentence for a refused password request, by status; the API's own sentence when it gave one. */
export function passwordFailure(e: unknown): Outcome {
  const status = isAxiosError(e) ? e.response?.status : undefined;
  if (status === 429) return { tone: "fail", title: t("Too many password changes"), detail: t("Wait a minute, then try again.") };
  if (status === 403) return { tone: "fail", title: t("Not allowed"), detail: errorSentence(e, t("Setting a password needs the manage users permission.")) };
  if (status === 422) return { tone: "fail", title: t("That password cannot be used"), detail: errorSentence(e, t("Choose a stronger password.")) };
  return { tone: "fail", title: t("The password was not changed"), detail: errorSentence(e, t("Try again.")) };
}

/** The local checks the API repeats: length, and the confirmation matching. Null when both pass. */
function localProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD_LENGTH) return t("Use at least {min} characters", { min: MIN_PASSWORD_LENGTH });
  if (pw !== confirm) return t("The new password and its confirmation do not match.");
  return null;
}

export function SetPasswordDialog({ user, onClose }: { user: { id: string; name: string }; onClose: () => void }) {
  const [mode, setMode] = useState<"generate" | "type">("generate");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { outcome, pending, run } = useOutcome();
  const submit = () => {
    setProblem(null);
    if (mode === "type") {
      const p = localProblem(pw, confirm);
      if (p) return setProblem(p);
    }
    void run("set", async () => {
      try {
        const r = await api.setUserPassword(user.id, mode === "generate" ? { generate: true } : { password: pw });
        setPw("");
        setConfirm("");
        if (r.password) setShown(r.password);
        return { tone: "ok", title: t("Password set for {name}", { name: user.name }), detail: t("They are signed out everywhere and must choose their own password when they next sign in.") };
      } catch (e) {
        return passwordFailure(e);
      }
    });
  };
  // Closing forgets the generated password: it is never shown again.
  const close = () => {
    setShown(null);
    onClose();
  };
  return (
    <Dialog title={t("Set a password for {name}", { name: user.name })} description={t("Hand it over yourself. They are signed out and must change it when they next sign in.")} onClose={close}>
      {shown ? (
        <>
          <p className="m2-prov">{t("Copy it now. It is shown once and never again.")}</p>
          <p className="m2-secret" aria-label={t("New password")} data-testid="shown-password">{shown}</p>
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={() => void copyText(shown).then(setCopied)}>
              {copied ? t("Copied") : t("Copy the password")}
            </button>
            <button type="button" className="m2-btn m2-strong" onClick={close}>
              {t("Done")}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="m2-aform" role="radiogroup" aria-label={t("How to set it")}>
            <label className="m2-sw">
              <input type="radio" name="pw-mode" checked={mode === "generate"} onChange={() => setMode("generate")} />
              <span>{t("Generate a strong password")}</span>
            </label>
            <label className="m2-sw">
              <input type="radio" name="pw-mode" checked={mode === "type"} onChange={() => setMode("type")} />
              <span>{t("Type one")}</span>
            </label>
            {mode === "type" ? (
              <>
                <label>
                  {t("New password")}
                  <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
                </label>
                <label>
                  {t("Confirm new password")}
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                </label>
                <p className="m2-prov">{t("At least {min} characters, not a common password.", { min: MIN_PASSWORD_LENGTH })}</p>
              </>
            ) : null}
          </div>
          {problem ? <p className="m2-prov" role="alert">{problem}</p> : null}
          {outcome ? <ResultFrame outcome={outcome} /> : null}
          <div className="m2-dlg-a">
            <button type="button" className="m2-btn" onClick={close}>
              {t("Cancel")}
            </button>
            <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={submit}>
              {pending ? t("Working…") : t("Set the password")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}

/** Preferences: change your own password, with the current one. */
export function ChangePasswordBlock() {
  const { changePassword } = useAuth();
  const { isAdmin } = useRole();
  const sso = useSsoEnforced();
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { outcome, pending, run } = useOutcome();
  if (sso && !isAdmin) return <p className="m2-prov">{t("Managed by your identity provider. Change your password there.")}</p>;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const p = localProblem(pw, confirm) ?? (pw === current ? t("The new password must differ from the current one.") : null);
    if (p) return setProblem(p);
    void run("change", async () => {
      try {
        await changePassword(current, pw);
        setCurrent("");
        setPw("");
        setConfirm("");
        return { tone: "ok", title: t("Password changed"), detail: t("Your other sessions are signed out.") };
      } catch (err) {
        return passwordFailure(err);
      }
    });
  };
  return (
    <form className="m2-aform" onSubmit={submit} noValidate>
      <label>
        {t("Current password")}
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label>
        {t("New password")}
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      </label>
      <label>
        {t("Confirm new password")}
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {problem ? <p className="m2-prov" role="alert">{problem}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <div>
        <button type="submit" className="m2-btn" disabled={pending !== null || !current || !pw}>
          {pending ? t("Saving…") : t("Change password")}
        </button>
      </div>
    </form>
  );
}
