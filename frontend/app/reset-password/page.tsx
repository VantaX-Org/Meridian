"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { resetPassword } from "@/lib/api/auth";

/** Server-side minimum (api.routes.auth._MIN_PASSWORD_LENGTH = 12). */
const MIN_PASSWORD_LENGTH = 12;

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError(
        "This link is missing its token. Open the link from your reset email exactly as sent.",
      );
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      toast.success("Password updated — please sign in.");
      router.replace("/sign-in?reset=1");
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      setError(
        typeof detail === "string"
          ? detail
          : "Could not reset password. The link may have expired — request a new one.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F7F8FA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 16px",
        fontFamily:
          "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif",
        color: "#0F172A",
      }}
    >
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div
          style={{
            padding: "20px 24px",
            background: "#F97316",
            borderRadius: "10px 10px 0 0",
          }}
        >
          <div
            style={{
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            Meridian · Data Quality
          </div>
          <h1
            style={{
              color: "#FFFFFF",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.01em",
              margin: "6px 0 0",
            }}
          >
            Choose a new password
          </h1>
        </div>
        <form
          onSubmit={onSubmit}
          style={{
            background: "#FFFFFF",
            padding: "28px 24px",
            borderRadius: "0 0 10px 10px",
            border: "1px solid #E5E7EB",
            borderTop: "none",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#475569", margin: 0 }}>
            Pick a new password for your Meridian account. Once you save it
            you&apos;ll be sent back to the sign-in page.
          </p>
          <div>
            <label
              htmlFor="rp-password"
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#64748B",
                marginBottom: 6,
              }}
            >
              New password
            </label>
            <input
              id="rp-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                background: "white",
                boxSizing: "border-box",
              }}
            />
            <p style={{ fontSize: 12, color: "#94A3B8", margin: "6px 0 0" }}>
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div>
            <label
              htmlFor="rp-confirm"
              style={{
                display: "block",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#64748B",
                marginBottom: 6,
              }}
            >
              Confirm password
            </label>
            <input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={MIN_PASSWORD_LENGTH}
              style={{
                width: "100%",
                padding: "10px 12px",
                border: "1px solid #E5E7EB",
                borderRadius: 8,
                fontSize: 14,
                background: "white",
                boxSizing: "border-box",
              }}
            />
          </div>
          {error && (
            <p
              style={{
                fontSize: 13,
                color: "#BB0000",
                background: "rgba(187,0,0,0.06)",
                padding: "10px 12px",
                borderRadius: 8,
                margin: 0,
              }}
              role="alert"
            >
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            style={{
              background: "#F97316",
              color: "#FFFFFF",
              border: "none",
              padding: "12px 22px",
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
              cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.7 : 1,
            }}
          >
            {submitting ? "Saving…" : "Reset password & sign in"}
          </button>
          <Link
            href="/sign-in"
            style={{
              textAlign: "center",
              fontSize: 13,
              color: "#64748B",
              textDecoration: "none",
            }}
          >
            Back to sign in
          </Link>
        </form>
        <div
          style={{
            marginTop: 18,
            textAlign: "center",
            fontSize: 11,
            color: "#94A3B8",
            letterSpacing: "0.06em",
          }}
        >
          MERIDIAN · © 2026 VANTAX
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
