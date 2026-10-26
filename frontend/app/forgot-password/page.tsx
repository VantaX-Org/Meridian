"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthFrame, authFormClass, authLinkClass } from "@/components/auth/auth-frame";
import { Button, Field, Input, Notice } from "@/design";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the email you sign in with");
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
    <AuthFrame title="Reset password"
      lead={submitted ? undefined : "We'll email a link that works for one hour."}>
      {submitted ? (
        <>
          <Notice tone="info" title="Check your email">
            If an account uses {email.trim()}, a reset link is on its way. The link is valid for one hour.
          </Notice>
          <p className="m-text-body m-ink-2">No email after a few minutes? Check spam, or ask your administrator to reset the password for you.</p>
        </>
      ) : (
        <form className={authFormClass} onSubmit={onSubmit} noValidate>
          <Field label="Work email" error={error ?? undefined}>
            <Input className="w-full" type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} />
          </Field>
          <Button type="submit" pending={submitting} className="w-full">Send link</Button>
        </form>
      )}
      <Link className={authLinkClass} href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
