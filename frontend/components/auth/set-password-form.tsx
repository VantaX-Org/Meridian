"use client";

/** Shared by reset-password and accept-invite: token from the URL, new password twice. */

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthFrame, PasswordField, authFormClass, authLinkClass } from "@/components/auth/auth-frame";
import { Button, Notice, toast } from "@/design";

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
const MIN_PASSWORD_LENGTH = 12;

export function SetPasswordForm({ title, lead, gate, submitLabel, missingToken, failure, done, redirect, submit, retryHref }: {
  title: string; lead: string; submitLabel: string; missingToken: string; failure: string; done: string; redirect: string;
  retryHref?: string;
  /** Wraps the form: accept-invite shows who the invite is for above it, and no form at all for a dead invite. */
  gate?: (form: ReactNode) => ReactNode;
  submit: (token: string, password: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Field errors sit under their field; only a server refusal or a missing token is a form-level notice.
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return setErrors({ form: missingToken });
    if (password.length < MIN_PASSWORD_LENGTH) return setErrors({ password: `Use at least ${MIN_PASSWORD_LENGTH} characters` });
    if (password !== confirm) return setErrors({ confirm: "Does not match the new password" });
    setErrors({});
    setSubmitting(true);
    try {
      await submit(token, password);
      toast.success(done);
      router.replace(redirect);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrors({ form: typeof detail === "string" ? detail : failure });
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form className={authFormClass} onSubmit={onSubmit} noValidate>
      {errors.form ? (
        <Notice tone="danger">
          {errors.form}
          {retryHref ? <> <Link className="underline" href={retryHref}>Request a new link</Link></> : null}
        </Notice>
      ) : null}
      <PasswordField label="New password" value={password} onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }} autoComplete="new-password"
        helper={`At least ${MIN_PASSWORD_LENGTH} characters.`} error={errors.password} />
      <PasswordField label="Confirm password" value={confirm} onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }} autoComplete="new-password" error={errors.confirm} />
      <Button type="submit" pending={submitting} className="w-full">{submitLabel}</Button>
    </form>
  );

  return (
    <AuthFrame title={title} lead={lead}>
      {gate ? gate(form) : form}
      <Link className={authLinkClass} href="/sign-in">Back to sign in</Link>
    </AuthFrame>
  );
}
