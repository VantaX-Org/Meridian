"use client";

/** Shared by reset password and accept an invitation: the token from the URL, the new password twice. */

import { useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { getInvitePreview } from "@/lib/api/auth";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Skeleton } from "../parts";
import { AuthFrame, AuthNote, PasswordField } from "./AuthFrame";

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
export const MIN_PASSWORD_LENGTH = 12;

export function SetPasswordForm({ title, lead, gate, submitLabel, missingToken, failure, redirect, submit, retryHref }: {
  title: string; lead: string; submitLabel: string; missingToken: string; failure: string; redirect: string;
  retryHref?: string;
  /** Wraps the form: accept an invitation shows who it is for above it, and no form at all for a dead invitation. */
  gate?: (form: ReactNode) => ReactNode;
  submit: (token: string, password: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Field errors sit under their field; only a server refusal or a missing token is a note for the whole form.
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return setErrors({ form: missingToken });
    if (password.length < MIN_PASSWORD_LENGTH) return setErrors({ password: t("Use at least {min} characters", { min: MIN_PASSWORD_LENGTH }) });
    if (password !== confirm) return setErrors({ confirm: t("Does not match the new password") });
    setErrors({});
    setSubmitting(true);
    try {
      await submit(token, password);
      // The sign-in page says the password was set (?reset=1 or ?invited=1).
      router.replace(redirect);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrors({ form: typeof detail === "string" ? detail : failure });
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form className="m2-auth-form" onSubmit={onSubmit} noValidate>
      {errors.form ? (
        <AuthNote tone="danger">
          {errors.form}
          {retryHref ? (
            <>
              {" "}
              <Link href={retryHref}>{t("Request a new link")}</Link>
            </>
          ) : null}
        </AuthNote>
      ) : null}
      <PasswordField label={t("New password")} value={password} onChange={(v) => { setPassword(v); setErrors((x) => ({ ...x, password: undefined })); }} autoComplete="new-password"
        hint={t("At least {min} characters.", { min: MIN_PASSWORD_LENGTH })} error={errors.password} />
      <PasswordField label={t("Confirm password")} value={confirm} onChange={(v) => { setConfirm(v); setErrors((x) => ({ ...x, confirm: undefined })); }} autoComplete="new-password" error={errors.confirm} />
      <button type="submit" className="m2-btn m2-next m2-wide" disabled={submitting}>
        {submitting ? t("Saving…") : submitLabel}
      </button>
    </form>
  );

  return (
    <AuthFrame title={title} lead={lead}>
      {gate ? gate(form) : form}
      <Link className="m2-auth-link" href="/sign-in">{t("Back to sign in")}</Link>
    </AuthFrame>
  );
}

/**
 * Who the invitation is for and what access it grants, above the password form (`children`). An invalid or expired
 * invitation says why and shows no form, since a password set against it cannot succeed.
 */
export function InvitePreview({ children = null }: { children?: ReactNode }) {
  const token = useSearchParams().get("token") ?? "";
  const q = useQuery({ queryKey: ["invite-preview", token], queryFn: () => getInvitePreview(token), enabled: !!token, retry: false });
  // No token: the form itself says the link is missing its token.
  if (!token) return <>{children}</>;
  if (q.isPending) {
    return (
      <div aria-busy="true">
        <Skeleton width="100%" height={64} />
      </div>
    );
  }
  if (q.isError) {
    const limited = isAxiosError(q.error) && q.error.response?.status === 429;
    return limited ? (
      <AuthNote tone="warning">{t("Too many attempts. Try again in a minute.")}</AuthNote>
    ) : (
      <AuthNote tone="danger" title={t("This invitation link is invalid or has expired.")}>
        {t("Ask your administrator to send a new invitation.")}
      </AuthNote>
    );
  }
  const { email, grants } = q.data;
  return (
    <>
      <section aria-label={t("Invitation")} className="m2-auth-note" data-tone="info">
        <strong>{t("Invited as {email}", { email })}</strong>
        {grants.length === 0 ? (
          <span>{t("No access has been granted yet.")}</span>
        ) : (
          <ul className="m2-auth-list">
            {grants.map((g, i) => (
              <li key={i}>
                {t("{role}, {system}, {object}", {
                  role: g.role_label,
                  system: g.system_name ?? t("all systems"),
                  object: g.module ? labelText(g.module) : t("all objects"),
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
      {children}
    </>
  );
}
