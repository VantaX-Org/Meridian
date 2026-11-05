"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { isAxiosError } from "axios";
import apiClient, { LEGACY_TOKEN_KEY, clearBrowserSession, hasSessionMarker, setSessionMarker } from "@/lib/api/client";
import { changeOwnPassword, logoutSession } from "@/lib/api/auth";
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
  isLoading: boolean;
  mustChangePassword: boolean;
  /**
   * Set when the stored session could not be checked for a reason other than being signed out (a 5xx or
   * a network failure). The session is kept so a retry can succeed; only a 401 signs the user out.
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

/** A pre-cookie localStorage token, if this browser still holds one. */
function legacyToken(): string | null {
  try {
    return localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // On mount (and on retry), validate the session with /me. It rides on the httponly cookie; the page knows
  // whether to ask from the readable marker cookie. A browser still holding the old localStorage token sends it
  // once as a bearer header: /me answers by setting the cookies, and the stored copy is removed. A 401 means the
  // session is over; any other failure keeps it, since the server, not the session, is the problem.
  useEffect(() => {
    let cancelled = false;
    const stored = legacyToken();
    const validate = stored || hasSessionMarker()
      ? apiClient
          .get("/api/v1/auth/me", stored ? { headers: { Authorization: `Bearer ${stored}` } } : undefined)
          .then((res) => {
            if (cancelled) return;
            if (stored) {
              try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* storage blocked */ }
              setSessionMarker(true);
            }
            setUser(res.data.user);
            setMustChangePassword(Boolean(res.data.must_change_password));
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            // 401 and 403 are the server's verdict on the session; anything else is the server's problem, so keep it and offer Retry.
            if (isAxiosError(e) && (e.response?.status === 401 || e.response?.status === 403)) {
              clearBrowserSession();
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
    const { user: newUser, must_change_password } = res.data;
    if (!isAuthUser(newUser)) throw new Error("Login response did not include a valid user.");
    // The session is the httponly cookie the response set; the token in the body is for machine clients.
    try { localStorage.removeItem(LEGACY_TOKEN_KEY); } catch { /* storage blocked */ }
    setSessionMarker(true);
    setUser(newUser);
    setMustChangePassword(Boolean(must_change_password));
    return newUser;
  }, []);

  const logout = useCallback(() => {
    // Rides on the cookie being dropped, so the sign-out is attributed and the server clears it; not awaited.
    // Other tabs notice on their next request, which the server answers 401.
    void logoutSession().finally(clearBrowserSession);
    clearLocalPreferences();
    setSessionMarker(false);
    setUser(null);
    setMustChangePassword(false);
  }, []);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      // The change revokes the old session; the response renewed the cookie.
      await changeOwnPassword(currentPassword, newPassword);
      setMustChangePassword(false);
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{ user, isLoading, mustChangePassword, error, retry, login, logout, changePassword }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** The signed-in user, or null (signed out, or outside the auth provider, as in a component test). Never throws. */
export function useCurrentUser(): AuthUser | null {
  return useContext(AuthContext)?.user ?? null;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within LocalAuthProvider");
  return ctx;
}
