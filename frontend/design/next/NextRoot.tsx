"use client";

import type { ReactNode } from "react";
import { useInterfaceLang } from "@/lib/v2/i18n";
import { ToastProvider } from "./kit/Toast";

/** The root of every "next" screen: carries the token scope, re-renders on a language change, hosts the toast region. */
export function NextRoot({ className, children }: { className: string; children: ReactNode }) {
  const { tag } = useInterfaceLang();
  return (
    <div className={`nx-root ${className}`} lang={tag || undefined} data-title-scope>
      <ToastProvider>{children}</ToastProvider>
    </div>
  );
}
