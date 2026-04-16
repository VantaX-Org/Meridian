"use client";

import { LocalAuthProvider } from "@/context/auth-context";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <LocalAuthProvider>{children}</LocalAuthProvider>;
}
