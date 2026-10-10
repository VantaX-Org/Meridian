"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { AuthFrame, AuthNotice, PasswordField, authActionsClass, authFormClass, authInputClass, authInputStyle, authLinkClass, authLinkStyle } from "@/components/auth/auth-frame";
import { Button, Field } from "@/design";
import { resolveNavHref } from "@/lib/nav";
import { isRole } from "@/hooks/use-role";

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
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("reset") === "1") setNotice("Password updated. Sign in with the new password.");
    else if (q.get("invited") === "1") setNotice("Password set. Sign in to finish joining.");
  }, []);

  useEffect(() => {
    if (error) noticeRef.current?.focus();
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
      const signedInUser = await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      const role = isRole(signedInUser.role) ? signedInUser.role : "viewer";
      router.push(
        next && next.startsWith("/") && !next.startsWith("//") ? next : resolveNavHref("/home/lead", role),
      );
    } catch (err: unknown) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame title="Sign in" lead="Use your work email. Your session stays on this server."
      side={
        <>
          <h2 className="text-[15px] leading-5 font-semibold" style={{ color: "var(--m-ink)" }}>Your SAP data stays on this server.</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13px] leading-[18px] marker:text-[12px] marker:leading-4 marker:[color:var(--m-ink-3)]" style={{ color: "var(--m-ink-2)" }}>
            <li><strong>Extracts and uploads</strong> are checked here, inside your own deployment.</li>
            <li><strong>Findings, records and reports</strong> are stored in this deployment&apos;s database.</li>
            <li><strong>The AI assistant</strong> sees field names and aggregate counts, never record values. A cloud model provider, if your administrator picked one, receives only those.</li>
            <li><strong>The licence check</strong> is the only other call that leaves the server.</li>
          </ol>
        </>
      }>
      <form className={authFormClass} onSubmit={handleSubmit} noValidate>
        {notice && !error ? <AuthNotice tone="success">{notice}</AuthNotice> : null}
        {error ? (
          <div ref={noticeRef} tabIndex={-1}>
            <AuthNotice tone="danger" title={error.title}>
              {error.title === "Email or password is wrong."
                ? error.detail ?? "Check your email and password and try again."
                : null}
            </AuthNotice>
          </div>
        ) : null}
        <Field label="Work email" error={emailError}>
          <input className={authInputClass} style={authInputStyle} type="email" required autoComplete="username"
            inputMode="email" autoFocus readOnly={loading} placeholder="you@company.com"
            aria-label="Work email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password"
          error={passwordError} readOnly={loading} />
        <div className={authActionsClass}>
          <Link className={authLinkClass} style={authLinkStyle} href="/forgot-password">Forgot password</Link>
        </div>
        <Button type="submit" aria-busy={loading} disabled={loading || invalid}
          style={loading || invalid ? { background: "var(--m-sheet-raised)", color: "var(--m-ink-3)" } : undefined}
          className="h-9 w-full">
          {loading ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </AuthFrame>
  );
}
