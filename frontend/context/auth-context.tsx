"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { isAxiosError } from "axios";
import apiClient from "@/lib/api/client";
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
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  /** Rotate the signed-in user's password and clear the
   * `must_change_password` flag. Throws on failure. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

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

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.post("/api/v1/auth/login", { email, password });
    const { token: newToken, user: newUser, must_change_password } = res.data;
    if (!isAuthUser(newUser)) throw new Error("Login response did not include a valid user.");
    localStorage.setItem(TOKEN_KEY, newToken);
    setSessionCookie(true);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(Boolean(must_change_password));
    return newUser;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    clearLocalPreferences();
    setSessionCookie(false);
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await apiClient.post(
        "/api/v1/auth/change-password",
        { current_password: currentPassword, new_password: newPassword },
      );
      // Success — clear the gate. Existing token still valid.
      setMustChangePassword(false);
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{ user, token, isLoading, mustChangePassword, error, retry, login, logout, changePassword }}
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
