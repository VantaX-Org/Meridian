"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthField, AuthFrame, AuthNote } from "@/design/v2/auth/AuthFrame";
import { t } from "@/lib/v2/i18n";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("Enter the email you sign in with"));
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // Same confirmation on any error: the page never reveals whether an account exists.
    } finally {
      setSubmitted(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame title={t("Reset password")} lead={submitted ? undefined : t("We will email a link that works for one hour.")}>
      {submitted ? (
        <>
          <AuthNote tone="info" title={t("Check your email")}>
            {t("If an account uses {email}, a reset link is on its way. The link is valid for one hour.", { email: email.trim() })}
          </AuthNote>
          <p className="m2-auth-lead">{t("No email after a few minutes? Check spam, or ask your administrator to reset the password for you.")}</p>
        </>
      ) : (
        <form className="m2-auth-form" onSubmit={onSubmit} noValidate>
          <AuthField label={t("Work email")} error={error ?? undefined}>
            {(p) => <input {...p} type="email" required autoComplete="email" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />}
          </AuthField>
          <button type="submit" className="m2-btn m2-next m2-wide" disabled={submitting}>
            {submitting ? t("Sending…") : t("Send link")}
          </button>
        </form>
      )}
      <Link className="m2-auth-link" href="/sign-in">{t("Back to sign in")}</Link>
    </AuthFrame>
  );
}
