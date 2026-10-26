"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { isAxiosError } from "axios";
import apiClient from "@/lib/api/client";
import { changeOwnPassword, verifyLoginCode, type LoginApiResponse } from "@/lib/api/auth";
import { clearLocalPreferences } from "@/lib/preferences";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Effective permissions for `role`, computed server-side (rbac.py). */
  permissions: string[];
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  mustChangePassword: boolean;
  /**
   * Set when the stored session could not be checked for a reason other than being signed out (a 5xx or
   * a network failure). The token is kept so a retry can succeed; only a 401 signs the user out.
   */
  error: string | null;
  /** Re-checks the stored session after an `error`. */
  retry: () => void;
  /**
   * The organisation requires two-factor sign-in and this user has none: the session reaches only the set-up
   * routes until it is confirmed (api/middleware/local_auth.py), so the guard shows the set-up screen.
   */
  mustEnrolTwoFactor: boolean;
  /** Email and password. A user with two-factor sign-in gets `mfa_required` and no session yet. */
  login: (email: string, password: string) => Promise<LoginResult>;
  /** The second sign-in step: the pending token from `login` and a code from the app or a recovery code. */
  verifyCode: (mfaToken: string, code: string) => Promise<AuthUser>;
  /** Set-up confirmed: store the full session that replaces the set-up-only one. */
  completeTwoFactorEnrolment: (token: string) => void;
  logout: () => void;
  /** Rotate the signed-in user's password and clear the
   * `must_change_password` flag. Throws on failure. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

export type LoginResult = { status: "signed_in"; user: AuthUser } | { status: "mfa_required"; mfaToken: string };

const AuthContext = createContext<AuthContextValue | null>(null);

/** Structural check for the login/me response's `user` field — it comes off
 *  an untyped axios body, so a bare `as AuthUser` would trust shape we never
 *  verified. */
function isAuthUser(x: unknown): x is AuthUser {
  if (!x || typeof x !== "object") return false;
  const u = x as Record<string, unknown>;
  return (
    typeof u.id === "string" &&
    typeof u.email === "string" &&
    typeof u.name === "string" &&
    typeof u.role === "string" &&
    Array.isArray(u.permissions) &&
    u.permissions.every((p) => typeof p === "string")
  );
}

const TOKEN_KEY = "mn_auth_token";

/** Signed-in marker for middleware.ts (the token itself never leaves localStorage). */
function setSessionCookie(on: boolean): void {
  document.cookie = on
    ? "mn_session=1; Path=/; SameSite=Lax; Max-Age=2592000"
    : "mn_session=; Path=/; SameSite=Lax; Max-Age=0";
}

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mustEnrolTwoFactor, setMustEnrolTwoFactor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // On mount (and on retry), check for a stored token and validate it. A 401 means the session is over
  // and the token goes; any other failure keeps it, since the server, not the session, is the problem.
  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem(TOKEN_KEY);
    const validate = stored
      ? apiClient
          .get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${stored}` } })
          .then((res) => {
            if (cancelled) return;
            setToken(stored);
            setUser(res.data.user);
            setMustChangePassword(Boolean(res.data.must_change_password));
            setMustEnrolTwoFactor(Boolean(res.data.must_enrol_2fa));
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            // 401 and 403 are the server's verdict on the token; anything else is the server's problem, so keep the token and offer Retry.
            if (isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
              localStorage.removeItem(TOKEN_KEY);
              setSessionCookie(false);
              return;
            }
            const status = isAxiosError(e) ? e.response?.status : undefined;
            setError(status ? `The server answered ${status} while checking your session.` : "Could not reach the server to check your session.");
          })
      : Promise.resolve();
    validate.finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => {
    setIsLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  /** Store the session a sign-in step returned. */
  const startSession = useCallback((body: LoginApiResponse): AuthUser => {
    const { token: newToken, user: newUser } = body;
    if (typeof newToken !== "string" || !newToken || !isAuthUser(newUser)) {
      throw new Error("Login response did not include a valid user.");
    }
    localStorage.setItem(TOKEN_KEY, newToken);
    setSessionCookie(true);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(Boolean(body.must_change_password));
    setMustEnrolTwoFactor(Boolean(body.must_enrol_2fa));
    return newUser;
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const res = await apiClient.post<LoginApiResponse>("/api/v1/auth/login", { email, password });
    if (res.data.mfa_required) {
      if (typeof res.data.mfa_token !== "string" || !res.data.mfa_token) {
        throw new Error("Login response asked for a code but did not include a sign-in token.");
      }
      return { status: "mfa_required", mfaToken: res.data.mfa_token };
    }
    return { status: "signed_in", user: startSession(res.data) };
  }, [startSession]);

  const verifyCode = useCallback(
    async (mfaToken: string, code: string) => startSession(await verifyLoginCode(mfaToken, code)),
    [startSession],
  );

  const completeTwoFactorEnrolment = useCallback((newToken: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setMustEnrolTwoFactor(false);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    clearLocalPreferences();
    setSessionCookie(false);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
    setMustEnrolTwoFactor(false);
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      // The change revokes the old token; changeOwnPassword has already stored its replacement.
      setToken(await changeOwnPassword(currentPassword, newPassword));
      setMustChangePassword(false);
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{
        user, token, isLoading, mustChangePassword, mustEnrolTwoFactor, error, retry,
        login, verifyCode, completeTwoFactorEnrolment, logout, changePassword,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within LocalAuthProvider");
  return ctx;
}
