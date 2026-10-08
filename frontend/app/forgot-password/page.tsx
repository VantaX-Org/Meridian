"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthFrame, AuthNotice, authActionsClass, authFormClass, authInputClass, authInputStyle, authLinkClass, authLinkStyle } from "@/components/auth/auth-frame";
import { Button, Field } from "@/design";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the email you sign in with.");
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
    <AuthFrame title="Reset your password"
      lead={submitted ? undefined : "Enter the email you sign in with. If it belongs to an account, we send a reset link."}>
      {submitted ? (
        <>
          <AuthNotice tone="success" title="Check your email">
            If an account uses {email.trim()}, a reset link is on its way. The link is valid for one hour.
          </AuthNotice>
          <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>No email after a few minutes? Check spam, or ask your administrator to reset the password for you.</p>
        </>
      ) : (
        <form className={authFormClass} onSubmit={onSubmit} noValidate>
          {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
          <Field label="Work email">
            <input className={authInputClass} style={authInputStyle} type="email" required autoComplete="email" autoFocus
              aria-label="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <div className={authActionsClass}>
            <Button type="submit" disabled={submitting}>{submitting ? "Sending" : "Send reset link"}</Button>
          </div>
        </form>
      )}
      <Link className={authLinkClass} style={authLinkStyle} href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
