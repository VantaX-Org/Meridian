"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import apiClient from "@/lib/api/client";

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

  // On mount, check for stored token and validate it
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    const validate = stored
      ? apiClient
          .get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${stored}` } })
          .then((res) => {
            setToken(stored);
            setUser(res.data.user);
            setMustChangePassword(Boolean(res.data.must_change_password));
          })
          .catch(() => {
            localStorage.removeItem(TOKEN_KEY);
            setSessionCookie(false);
          })
      : Promise.resolve();
    validate.finally(() => setIsLoading(false));
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
      value={{ user, token, isLoading, mustChangePassword, login, logout, changePassword }}
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
