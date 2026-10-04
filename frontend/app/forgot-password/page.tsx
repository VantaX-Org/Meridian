"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api/auth";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Banner, Button, Field, Input } from "@/components/ui-core";

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
          <Banner tone="success" title="Check your email">
            If an account uses {email.trim()}, a reset link is on its way. The link is valid for one hour.
          </Banner>
          <p className="ui-auth__lead">No email after a few minutes? Check spam, or ask your administrator to reset the password for you.</p>
        </>
      ) : (
        <form className="ui-form" onSubmit={onSubmit} noValidate>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Field label="Work email" required>
            {({ controlId }) => <Input id={controlId} type="email" required autoComplete="email" autoFocus
              value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <div className="ui-form__actions">
            <Button type="submit" disabled={submitting}>{submitting ? "Sending" : "Send reset link"}</Button>
          </div>
        </form>
      )}
      <Link className="ui-link" href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
