/** Browser side of OIDC sign-in: the address that starts it, the sentences for its failure codes, and the hand-over
 *  of the session: the server has already set the session cookie, and the fragment only says so. */
import { t } from "@/lib/v2/i18n";
import { setSessionMarker } from "@/lib/api/client";

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
  email_unverified: () =>
    t("Your identity provider has not confirmed this email address, so it cannot be linked to an existing account. Ask an administrator."),
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
 * If the URL fragment says the OIDC callback has signed the browser in (`sso=1`; the session itself is the httponly
 * cookie the callback set, never in the URL), mark the page signed in, clear the fragment, and return where to go
 * next; otherwise null. The caller does a full navigation so the auth provider validates the session on load.
 */
export function takeSsoSession(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  if (params.get("sso") !== "1") return null;
  setSessionMarker(true);
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  return safeNext(params.get("next"));
}
