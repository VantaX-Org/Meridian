"use client";

import { useEffect, type ReactNode } from "react";
import { useInterfaceLang } from "@/lib/v2/i18n";
import { themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { DemoBar } from "./DemoBar";

/** Puts the interface language on <html> while a page is open (WCAG 3.1.1), and puts back what was there. */
export function useDocumentLang(tag: string): void {
  useEffect(() => {
    const html = document.documentElement;
    const before = html.lang;
    html.lang = tag;
    return () => {
      html.lang = before;
    };
  }, [tag]);
}

/** The root for a page that stands without the shell (signed-out pages, not found): tokens, language, tenant accent, demo bar. */
export function Standalone({ children }: { children: ReactNode }) {
  const { tag } = useInterfaceLang();
  const theme = useTenantTheme();
  useDocumentLang(tag);
  return (
    <div key={tag} className="mx-root mx-standalone" lang={tag} {...themeRootProps(theme)}>
      <DemoBar />
      <main className="mx-main">{children}</main>
    </div>
  );
}
