"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/context/auth-context";
import { MeridianMark, MailIcon, LockIcon, ArrowRight } from "@/components/meridian/icons";

export default function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      {/* ── Left: form ────────────────────────────────────── */}
      <section className="login-left">
        <div className="login-brand">
          <div className="login-brand-mark">
            <MeridianMark size={32} />
          </div>
          <div>
            <div className="login-wordmark">Meridian</div>
            <div className="login-wordmark-sub">Data Quality</div>
          </div>
        </div>

        <div className="login-form-wrap">
          <div className="login-eyebrow">Sign in</div>
          <h1 className="login-h1">Welcome back.</h1>
          <p className="login-sub">
            Use your work email to access the Meridian estate. Sessions are tied to your single-sign-on if configured by your administrator.
          </p>

          <form onSubmit={handleSubmit} noValidate>
            {error && <div className="login-error">{error}</div>}

            <div className="login-field">
              <label className="login-label" htmlFor="email">
                Work email
              </label>
              <div className="login-input-wrap">
                <MailIcon size={16} />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="password">
                Password
              </label>
              <div className="login-input-wrap">
                <LockIcon size={16} />
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="login-show-pw"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "HIDE" : "SHOW"}
                </button>
              </div>
            </div>

            <div className="login-row">
              <label className="login-check">
                <input
                  type="checkbox"
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                />
                <span className="box" />
                <span>Keep me signed in</span>
              </label>
              <Link className="login-forgot" href="/forgot-password">
                Forgot password?
              </Link>
            </div>

            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
              {!loading && <ArrowRight size={14} />}
            </button>
          </form>
        </div>

        <div className="login-foot">
          <div>© {new Date().getFullYear()} Meridian · v4.2</div>
          <div className="stack">
            <Link href="#">Privacy</Link>
            <Link href="#">Terms</Link>
            <Link href="#">Status</Link>
          </div>
        </div>
      </section>

      {/* ── Right: brand + live preview ───────────────────── */}
      <aside className="login-right">
        <div className="login-right-inner">
          <div className="login-marquee">Data Quality · Master Data · Stewardship</div>

          <div className="login-headline">
            <h2>
              One source of truth for your <span className="accent">SAP estate</span>.
            </h2>
            <p>
              Meridian profiles, scores and remediates master data across S/4HANA, ECC and the cloud — so every record in your ledger means what it says.
            </p>
          </div>

          <div className="login-preview">
            <div className="login-preview-head">
              <span className="login-preview-eyebrow">DQS · Estate composite</span>
              <span className="login-preview-pill">
                <span className="dot" /> LIVE
              </span>
            </div>
            <div className="login-preview-value">
              <span className="login-preview-num">87.4</span>
              <span className="login-preview-suffix">/ 100</span>
              <span className="login-preview-delta">▲ +2.3 pts</span>
            </div>
            <div className="login-preview-spark">
              <svg viewBox="0 0 240 38" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="login-spark-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--mn-primary)" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="var(--mn-primary)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M 2 28 C 24 25, 36 22, 52 22 C 68 22, 80 16, 96 16 C 112 16, 124 13, 140 13 C 156 13, 168 11, 184 10 C 200 10, 212 8, 238 6"
                  fill="none"
                  stroke="var(--mn-primary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M 2 28 C 24 25, 36 22, 52 22 C 68 22, 80 16, 96 16 C 112 16, 124 13, 140 13 C 156 13, 168 11, 184 10 C 200 10, 212 8, 238 6 L 238 38 L 2 38 Z"
                  fill="url(#login-spark-fill)"
                />
                <circle cx="238" cy="6" r="3" fill="var(--mn-primary)" />
                <circle cx="238" cy="6" r="6" fill="none" stroke="var(--mn-primary)" strokeOpacity="0.4">
                  <animate attributeName="r" values="3;9;3" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="stroke-opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>
            <div className="login-preview-foot">
              <span>Q2 QUARTERLY AUDIT</span>
              <span>UPDATED · 14:32 UTC</span>
            </div>
          </div>

          <div className="login-stats">
            <div className="stat">
              <div className="v">142,840</div>
              <div className="l">RECORDS UNDER WATCH</div>
            </div>
            <div className="stat">
              <div className="v">6 systems</div>
              <div className="l">CONNECTED TO ESTATE</div>
            </div>
            <div className="stat">
              <div className="v">99.4%</div>
              <div className="l">SLA · LAST 7 DAYS</div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
