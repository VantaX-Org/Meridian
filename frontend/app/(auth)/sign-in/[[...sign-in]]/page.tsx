"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { AuthField, AuthFrame, AuthNote, PasswordField } from "@/design/v2/auth/AuthFrame";
import { safeNext, ssoErrorSentence, ssoStartHref, takeSsoSession } from "@/design/v2/auth/sso";
import { getOidcPublicConfig, type OidcPublicConfig } from "@/lib/api/sso";
import { t } from "@/lib/v2/i18n";
import { useDocumentAccent, useTenantTheme } from "@/lib/v2/theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LoginError = { title: string; detail?: string };

function describeError(err: unknown): LoginError {
  const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
  const status = axiosErr.response?.status;
  const detail = axiosErr.response?.data?.detail;
  if (status === 401) return { title: t("Email or password is wrong."), detail: detail ?? t("Check your email and password and try again.") };
  if (status === 429) return { title: t("Too many attempts. Wait a minute and try again.") };
  if (status === undefined || status >= 500) return { title: t("Meridian could not be reached. Check that the server is running.") };
  return { title: detail || t("Sign-in failed.") };
}

export default function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  // Single sign-on (null until /auth/oidc/config answers; a failure leaves the password form as the only way in).
  const [sso, setSso] = useState<OidcPublicConfig | null>(null);
  const [ssoError, setSsoError] = useState<string | null>(null);
  const [adminForm, setAdminForm] = useState(false);
  const [next, setNext] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // The tenant's look (GET /theme, public): its logo and name above the form (AuthFrame), its accent on the page.
  useDocumentAccent(useTenantTheme());

  useEffect(() => {
    // Back from the identity provider: the callback leaves the session token in the URL fragment.
    const landed = takeSsoSession();
    if (landed) {
      window.location.replace(landed);
      return;
    }
    const query = new URLSearchParams(window.location.search);
    setSsoError(ssoErrorSentence(query.get("sso_error")));
    setNext(query.get("next"));
    if (query.get("reset") === "1") setNotice(t("Password updated. Sign in with the new password."));
    else if (query.get("invited") === "1") setNotice(t("Password set. Sign in to finish joining."));
    let live = true;
    getOidcPublicConfig().then((c) => { if (live) setSso(c); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (error) noticeRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (!error) return;
    const clear = (e: KeyboardEvent) => { if (e.key === "Escape") setError(null); };
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, [error]);

  const invalid = !EMAIL_RE.test(email.trim()) || !password;
  const emailError = attempted && !EMAIL_RE.test(email.trim()) ? t("Enter your work email") : undefined;
  const passwordError = attempted && !password ? t("Enter your password") : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setError(null);
    if (invalid) return;
    setLoading(true);
    try {
      await login(email, password);
      // The landscape shapes itself for the role (its next-step button) once /me/permissions has loaded.
      router.push(safeNext(new URLSearchParams(window.location.search).get("next")));
    } catch (err: unknown) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const showForm = !sso?.enforce || adminForm;

  return (
    <AuthFrame title={t("Sign in")}>
      {ssoError ? <AuthNote tone="danger">{ssoError}</AuthNote> : null}
      {sso?.enabled ? (
        <a className="m2-btn m2-wide" href={ssoStartHref(next)}>
          {t("Continue with {provider}", { provider: sso.display_name ?? t("single sign-on") })}
        </a>
      ) : null}
      {sso?.enabled && showForm ? <p className="m2-auth-meta">{t("Or use your email and password")}</p> : null}
      {showForm ? (
        <form className="m2-auth-form" onSubmit={handleSubmit} noValidate>
          {notice && !error ? <AuthNote tone="info">{notice}</AuthNote> : null}
          {error ? (
            <AuthNote ref={noticeRef} focusable tone="danger" title={error.title}>
              {error.detail}
            </AuthNote>
          ) : null}
          <AuthField label={t("Work email")} error={emailError}>
            {(p) => (
              <input {...p} type="email" required autoComplete="username" inputMode="email" autoFocus readOnly={loading} placeholder={t("you@company.com")} value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </AuthField>
          <PasswordField label={t("Password")} value={password} onChange={setPassword} autoComplete="current-password" error={passwordError} readOnly={loading} />
          <Link className="m2-auth-link" href="/forgot-password">{t("Forgot password?")}</Link>
          <button type="submit" className="m2-btn m2-next m2-wide" disabled={loading}>
            {loading ? t("Signing in…") : t("Sign in")}
          </button>
        </form>
      ) : (
        <button type="button" className="m2-auth-link" onClick={() => setAdminForm(true)}>
          {t("Administrator sign-in")}
        </button>
      )}
    </AuthFrame>
  );
}
