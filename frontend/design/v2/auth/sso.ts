/** Browser side of OIDC sign-in: the address that starts it, the sentences for its failure codes, and the hand-over
 *  of the session token the server puts in the URL fragment (a fragment never reaches a server or a log). */
import { t } from "@/lib/v2/i18n";

/** Same key as context/auth-context.tsx and lib/api/auth.ts. */
const TOKEN_KEY = "mn_auth_token";

/** Codes the server redirects with (api/routes/auth_oidc.py ERROR_SENTENCES) and what the page says for each. */
export const SSO_ERROR_SENTENCES: Record<string, () => string> = {
  not_configured: () => t("Single sign-on is not set up. Use your email and password."),
  provider_unreachable: () => t("The identity provider could not be reached. Try again in a minute."),
  denied: () => t("Sign-in was cancelled or refused by your identity provider."),
  expired: () => t("That sign-in took too long or was started in another browser. Start again."),
  invalid_token: () => t("Your identity could not be verified. Try signing in again."),
  email_missing: () => t("Your identity provider did not share a verified email address."),
  domain_not_allowed: () => t("Your email domain is not allowed to sign in here. Ask an administrator."),
  suspended: () => t("This account is suspended. Ask an administrator to reactivate it."),
  subject_conflict: () => t("This account is already linked to a different identity. Ask an administrator."),
  seats_full: () => t("Licence seats are full, so a new account could not be created. Ask an administrator."),
  failed: () => t("Single sign-on failed. Try again, or use your email and password."),
};

/** The sentence for a redirect code; an unknown code reads as the generic failure, never as the raw text. */
export function ssoErrorSentence(code: string | null): string | null {
  if (!code) return null;
  return (SSO_ERROR_SENTENCES[code] ?? SSO_ERROR_SENTENCES.failed)();
}

/** A same-site path or "/" (the landscape): the page never navigates to an address it was handed. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}

/** The server address that starts sign-in, carrying the page to land on afterwards. */
export function ssoStartHref(next: string | null): string {
  const target = safeNext(next);
  return target === "/" ? "/api/v1/auth/oidc/start" : `/api/v1/auth/oidc/start?next=${encodeURIComponent(target)}`;
}

/**
 * If the URL fragment carries a session token from the OIDC callback, store it as password sign-in does, clear
 * the fragment, and return where to go next; otherwise null. The caller does a full navigation so the auth
 * provider validates the stored token on load.
 */
export function takeSsoSession(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const token = params.get("sso_token");
  if (!token) return null;
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    return null;
  }
  document.cookie = "mn_session=1; Path=/; SameSite=Lax; Max-Age=2592000";
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return safeNext(params.get("next"));
}
