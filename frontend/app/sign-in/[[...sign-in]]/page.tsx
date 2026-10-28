"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { AuthFrame, PasswordField, authFormClass, authLinkClass } from "@/components/auth/auth-frame";
import { Button, Field, Notice } from "@/design";
import { SsoSignInButton } from "@/components/auth/sso-sign-in";
import { ssoErrorSentence, takeSsoSession } from "@/components/auth/sso";
import { getOidcPublicConfig, type OidcPublicConfig } from "@/lib/api/sso";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LoginError = { title: string; detail?: string };

function describeError(err: unknown): LoginError {
  const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
  const status = axiosErr.response?.status;
  const detail = axiosErr.response?.data?.detail;
  if (status === 401) return { title: "Email or password is wrong.", detail };
  if (status === 429) return { title: "Too many attempts. Wait a minute and try again." };
  if (status === undefined || status >= 500) {
    return { title: "Meridian could not be reached. Check that the server is running." };
  }
  return { title: detail || "Login failed" };
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
    let live = true;
    getOidcPublicConfig().then((c) => { if (live) setSso(c); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("reset") === "1") setNotice("Password updated. Sign in with the new password.");
    else if (q.get("invited") === "1") setNotice("Password set. Sign in to finish joining.");
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
  const emailError = attempted && !EMAIL_RE.test(email.trim()) ? "Enter your work email" : undefined;
  const passwordError = attempted && !password ? "Enter your password" : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setError(null);
    if (invalid) return;
    setLoading(true);
    try {
      await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      // /home decides the landing page once /me/permissions has loaded: the user's role alone cannot say whether a
      // steward may open Fix work, or whether a scoped grant makes them a steward at all.
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/home");
    } catch (err: unknown) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  const showForm = !sso?.enforce || adminForm;

  return (
    <AuthFrame title="Sign in">
      <div className={authFormClass}>
        {ssoError ? <Notice tone="danger">{ssoError}</Notice> : null}
        {sso?.enabled ? <SsoSignInButton displayName={sso.display_name ?? "single sign-on"} next={next} /> : null}
        {sso?.enabled && showForm ? <p className="m-text-meta m-ink-3">Or use your email and password</p> : null}
        {showForm ? (
          <form className={authFormClass} onSubmit={handleSubmit} noValidate>
            {notice && !error ? <Notice tone="info">{notice}</Notice> : null}
            {error ? (
              <div ref={noticeRef} tabIndex={-1}>
                <Notice tone="danger" title={error.title}>
                  {error.title === "Email or password is wrong."
                    ? error.detail ?? "Check your email and password and try again."
                    : null}
                </Notice>
              </div>
            ) : null}
            <Field label="Work email" error={emailError}>
              <input className="m-input w-full" type="email" required autoComplete="username"
                inputMode="email" autoFocus readOnly={loading} placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password"
              error={passwordError} readOnly={loading} />
            <div className="flex items-center">
              <Link className={authLinkClass} href="/forgot-password">Forgot password?</Link>
            </div>
            <Button type="submit" pending={loading} className="w-full">Sign in</Button>
          </form>
        ) : (
          <button type="button" className={`${authLinkClass} self-start`} onClick={() => setAdminForm(true)}>Administrator sign-in</button>
        )}
      </div>
    </AuthFrame>
  );
}
