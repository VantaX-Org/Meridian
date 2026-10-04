"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { AuthFrame, PasswordField } from "@/components/auth/auth-frame";
import { Banner, Button, Field, Input } from "@/components/ui-core";

export default function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("reset") === "1") setNotice("Password updated. Sign in with the new password.");
    else if (q.get("invited") === "1") setNotice("Password set. Sign in to finish joining.");
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      const next = new URLSearchParams(window.location.search).get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthFrame title="Sign in" lead="Use the work email your administrator invited."
      side={
        <>
          <h2 className="ui-auth__title">Your SAP data stays on this server</h2>
          <ol className="ui-auth__steps">
            <li><strong>Extracts and uploads</strong> are checked here, inside your own deployment.</li>
            <li><strong>Findings, records and reports</strong> are stored in this deployment&apos;s database.</li>
            <li><strong>The AI assistant</strong> sees field names and aggregate counts, never record values. A cloud model provider, if your administrator picked one, receives only those.</li>
            <li><strong>The licence check</strong> is the only other call that leaves the server.</li>
          </ol>
        </>
      }>
      <form className="ui-form" onSubmit={handleSubmit} noValidate>
        {notice && !error ? <Banner tone="success">{notice}</Banner> : null}
        {error ? <Banner tone="danger" title="Not signed in">{error}</Banner> : null}
        <Field label="Work email" required>
          {({ controlId }) => <Input id={controlId} type="email" required autoComplete="email" placeholder="you@company.com"
            value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="ui-form__actions">
          <Button type="submit" disabled={loading || !email || !password}>{loading ? "Signing in" : "Sign in"}</Button>
          <Link className="ui-link" href="/forgot-password">Forgot password</Link>
        </div>
      </form>
    </AuthFrame>
  );
}
