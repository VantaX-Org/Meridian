"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import apiClient from "@/lib/api/client";

interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  mustChangePassword: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Rotate the signed-in user's password and clear the
   * `must_change_password` flag. Throws on failure. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "mn_auth_token";

export function LocalAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mustChangePassword, setMustChangePassword] = useState(false);

  // On mount, check for stored token and validate it
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }
    apiClient
      .get("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${stored}` },
      })
      .then((res) => {
        setToken(stored);
        setUser(res.data.user);
        setMustChangePassword(Boolean(res.data.must_change_password));
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await apiClient.post("/api/v1/auth/login", { email, password });
    const { token: newToken, user: newUser, must_change_password } = res.data;
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
    setUser(newUser);
    setMustChangePassword(Boolean(must_change_password));
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
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
