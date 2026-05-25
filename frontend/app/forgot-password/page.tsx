"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/lib/api/auth";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter the email you sign in with.");
      return;
    }
    setSubmitting(true);
    try {
      await requestPasswordReset(email.trim());
      // Always show the same confirmation — backend deliberately doesn't
      // reveal whether an account exists, to prevent enumeration.
      setSubmitted(true);
    } catch {
      // Same generic confirmation on transport errors — still no leak.
      setSubmitted(true);
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
            Reset your password
          </h1>
        </div>
        <div
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
          {submitted ? (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "#475569", margin: 0 }}>
                If <strong style={{ color: "#0F172A" }}>{email}</strong> matches
                an account on this Meridian deployment, we&apos;ve sent a reset
                link. The link is valid for one hour.
              </p>
              <p style={{ fontSize: 13, color: "#94A3B8", margin: 0 }}>
                Didn&apos;t receive it? Check spam, then ask an administrator
                to resend.
              </p>
              <Link
                href="/sign-in"
                style={{
                  marginTop: 4,
                  textAlign: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#F97316",
                  textDecoration: "none",
                }}
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <form
              onSubmit={onSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "#475569",
                  margin: 0,
                }}
              >
                Enter the email address linked to your account. We&apos;ll send
                you a link to set a new password.
              </p>
              <div>
                <label
                  htmlFor="fp-email"
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
                  Email
                </label>
                <input
                  id="fp-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
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
                {submitting ? "Sending…" : "Send reset link"}
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
          )}
        </div>
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
