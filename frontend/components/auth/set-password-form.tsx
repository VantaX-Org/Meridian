"use client";

/** Shared by reset-password and accept-invite: token from the URL, new password twice. */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AuthFrame, AuthNotice, PasswordField, authActionsClass, authFormClass, authLinkClass, authLinkStyle } from "@/components/auth/auth-frame";
import { Button } from "@/design";

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
const MIN_PASSWORD_LENGTH = 12;

export function SetPasswordForm({ title, lead, submitLabel, missingToken, failure, done, redirect, submit }: {
  title: string; lead: string; submitLabel: string; missingToken: string; failure: string; done: string; redirect: string;
  submit: (token: string, password: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) return setError(missingToken);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (password !== confirm) return setError("Passwords don't match.");
    setSubmitting(true);
    try {
      await submit(token, password);
      toast.success(done);
      router.replace(redirect);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : failure);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthFrame title={title} lead={lead}>
      <form className={authFormClass} onSubmit={onSubmit} noValidate>
        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}
        <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password"
          helper={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <div className={authActionsClass}>
          <Button type="submit" disabled={submitting}>{submitting ? "Saving" : submitLabel}</Button>
        </div>
      </form>
      <Link className={authLinkClass} style={authLinkStyle} href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
