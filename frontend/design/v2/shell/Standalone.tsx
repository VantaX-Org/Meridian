"use client";

import { useEffect, type ReactNode } from "react";
import { useInterfaceLang } from "@/lib/v2/i18n";
import { themeRootProps, useTenantTheme } from "@/lib/v2/theme";
import { DemoBar } from "./DemoBar";

/** Puts the interface language on <html> while a v2 page is open (WCAG 3.1.1), and puts back what was there. */
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

/**
 * The v2 root for a page that stands without the shell (the status page): the tokens, the language, the tenant's
 * accent, and a page that scrolls as a whole.
 */
export function StandaloneRoot({ children }: { children: ReactNode }) {
  const { tag } = useInterfaceLang();
  const theme = useTenantTheme();
  useDocumentLang(tag);
  return (
    <div key={tag} className="m2-root m2-standalone" data-m2="" lang={tag} {...themeRootProps(theme)}>
      <DemoBar />
      {children}
    </div>
  );
}
