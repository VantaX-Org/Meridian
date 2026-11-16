"use client";

import { lazy, Suspense, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/design/v2/auth/Guard";
import { RequestAccessHost } from "@/design/v2/RequestAccess";
import { useAuth } from "@/context/auth-context";
import { usePreferencesSync } from "@/hooks/use-preferences";
import { PermissionsProvider } from "@/lib/permissions";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { PATHS } from "@/lib/next/nav-defaults";
import { AletheiaProvider, AppShell, useAletheia } from "@/ui/kit";

// Lazy slot: the one chat instance, scoped by whichever screen is open.
const AletheiaPanel = lazy(() => import("@/ui/kit/AletheiaPanel"));

function PreferencesSync() {
  const { user } = useAuth();
  usePreferencesSync(user?.id);
  return null;
}

function ChatHost({ children }: { children: ReactNode }) {
  return <AletheiaProvider initialOpen={useSearchParams().get("aletheia") === "1"}>{children}</AletheiaProvider>;
}

function Shell({ children }: { children: ReactNode }) {
  useInterfaceLang();
  const fx = useFixture();
  const path = usePathname() ?? "";
  const { user, logout } = useAuth();
  const chat = useAletheia();
  const link = (p: string) => withFixture(p, fx);
  const sections = [
    { id: "home", label: t("Home"), href: PATHS.home },
    { id: "work", label: t("Work"), href: PATHS.work },
    { id: "load", label: t("Load"), href: PATHS.load },
    { id: "runs", label: t("Runs"), href: PATHS.runs },
    { id: "more", label: t("More"), href: PATHS.more },
  ].map((s) => ({ ...s, href: link(s.href), active: s.href !== "/" && path.startsWith(s.href) }));
  return (
    <AppShell
      brand={t("Meridian")}
      sections={sections}
      navLabel={t("Main sections")}
      user={{ name: user?.name ?? user?.email ?? t("Demo user"), email: user?.email }}
      userMenuLabel={t("Account menu")}
      menu={fx ? [] : [{ id: "out", label: t("Sign out"), onClick: logout }]}
      launcher={{ label: t("Ask Aletheia"), onOpen: () => chat.setOpen(true) }}
      aside={chat.open ? (
        <Suspense fallback={null}>
          <AletheiaPanel
            labels={{ title: t("Aletheia"), scope: t("Asking about the whole landscape"), close: t("Close"), inputLabel: t("Ask a question"), send: t("Send"), evidence: t("Evidence"), suggestionsLabel: t("Suggested questions"), threadLabel: t("Conversation") }}
          />
        </Suspense>
      ) : null}
    >
      {children}
    </AppShell>
  );
}

/** Same sign-in and permissions chain as the current app; fixture mode skips sign-in. */
export function Frame({ children }: { children: ReactNode }) {
  const fx = useFixture();
  const inner = <Suspense fallback={null}><ChatHost><Shell>{children}</Shell></ChatHost></Suspense>;
  if (fx) return <div className="mx-root">{inner}</div>;
  return (
    <AuthGuard>
      <PermissionsProvider>
        <PreferencesSync />
        <div className="mx-root">{inner}</div>
        <RequestAccessHost />
      </PermissionsProvider>
    </AuthGuard>
  );
}
