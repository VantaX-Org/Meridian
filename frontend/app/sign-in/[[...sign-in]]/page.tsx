"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { AuthFrame, PasswordField, authFormClass, authLinkClass } from "@/components/auth/auth-frame";
import { Button, Field, Notice } from "@/design";

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

/** Where to go once signed in: a same-site `?next=` path, else /home. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  // /home decides the landing page once /me/permissions has loaded: the user's role alone cannot say whether a
  // steward may open Fix work, or whether a scoped grant makes them a steward at all.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/home";
}

function describeCodeError(err: unknown): { title: string; restart: boolean } {
  const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } };
  const status = axiosErr.response?.status;
  const detail = axiosErr.response?.data?.detail;
  if (status === 400) return { title: detail || "Your sign-in timed out. Enter your email and password again.", restart: true };
  if (status === 422) return { title: detail || "That code did not work.", restart: false };
  if (status === 429) return { title: "Too many codes tried. Wait a few minutes and try again.", restart: false };
  if (status === undefined || status >= 500) return { title: "Meridian could not be reached. Check that the server is running.", restart: false };
  return { title: detail || "Sign-in failed", restart: false };
}

/** The second step for an account with two-factor sign-in: a code from the app, or a recovery code. */
function CodeStep({ mfaToken, onRestart }: { mfaToken: string; onRestart: (notice: string) => void }) {
  const router = useRouter();
  const { verifyCode } = useAuth();
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const value = code.trim().replace(/\s+/g, "");
  const invalid = recovery ? value.replace(/-/g, "").length !== 16 : !/^\d{6}$/.test(value);
  const fieldError = attempted && invalid ? (recovery ? "Enter one of your recovery codes" : "Enter the 6-digit code") : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setError(null);
    if (invalid) return;
    setLoading(true);
    try {
      await verifyCode(mfaToken, value);
      router.push(nextPath());
    } catch (err: unknown) {
      const { title, restart } = describeCodeError(err);
      if (restart) onRestart(title);
      else setError(title);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame title="Enter your code"
      lead={recovery ? "Enter one of the recovery codes you saved when you set up two-factor sign-in. Each code works once." : "Open your authenticator app and enter the 6-digit code it shows for Meridian."}>
      <form className={authFormClass} onSubmit={handleSubmit} noValidate>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Field label={recovery ? "Recovery code" : "Code from the app"} error={fieldError}>
          <input key={recovery ? "recovery" : "totp"} className="m-input w-full" autoFocus readOnly={loading}
            inputMode={recovery ? "text" : "numeric"} autoComplete="one-time-code" autoCapitalize="characters"
            placeholder={recovery ? "XXXX-XXXX-XXXX-XXXX" : "123456"} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" className={authLinkClass} onClick={() => { setRecovery(!recovery); setCode(""); setAttempted(false); setError(null); }}>
            {recovery ? "Use a code from the app" : "Use a recovery code"}
          </button>
          <button type="button" className={authLinkClass} onClick={() => onRestart("")}>Start again</button>
        </div>
        <Button type="submit" pending={loading} className="w-full">Sign in</Button>
      </form>
    </AuthFrame>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const noticeRef = useRef<HTMLDivElement>(null);

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
      const result = await login(email, password);
      if (result.status === "mfa_required") {
        setPassword("");
        setMfaToken(result.mfaToken);
        return;
      }
      router.push(nextPath());
    } catch (err: unknown) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  if (mfaToken) {
    return <CodeStep mfaToken={mfaToken} onRestart={(why) => { setMfaToken(null); setNotice(why); }} />;
  }

  return (
    <AuthFrame title="Sign in">
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
    </AuthFrame>
  );
}
