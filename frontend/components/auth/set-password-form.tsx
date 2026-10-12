"use client";

/** Shared by reset-password and accept-invite: token from the URL, new password twice. */

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AuthFrame, PasswordField, authFormClass, authLinkClass, authLinkStyle } from "@/components/auth/auth-frame";
import { Button, Notice } from "@/design";

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
const MIN_PASSWORD_LENGTH = 12;

export function SetPasswordForm({ title, lead, intro, submitLabel, missingToken, failure, done, redirect, submit, retryHref }: {
  title: string; lead: string; submitLabel: string; missingToken: string; failure: string; done: string; redirect: string;
  retryHref?: string;
  /** Rendered inside the card above the form (accept-invite shows who the invite is for). */
  intro?: ReactNode;
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
      {intro}
      <form className={authFormClass} onSubmit={onSubmit} noValidate>
        {error ? (
          <Notice tone="danger">
            {error}
            {retryHref ? <> <Link className="underline" href={retryHref}>Request a new link</Link></> : null}
          </Notice>
        ) : null}
        <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password"
          helper={`At least ${MIN_PASSWORD_LENGTH} characters.`} />
        <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <Button type="submit" pending={submitting} className="w-full">{submitLabel}</Button>
      </form>
      <Link className={authLinkClass} style={authLinkStyle} href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
