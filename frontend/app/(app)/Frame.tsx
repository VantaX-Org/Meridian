"use client";

import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AuthGuard } from "@/ui/auth/Guard";
import { RequestAccessHost } from "@/ui/auth/RequestAccess";
import { useAuth } from "@/context/auth-context";
import { usePreferencesSync } from "@/hooks/use-preferences";
import { PermissionsProvider } from "@/lib/permissions";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { PATHS } from "@/lib/next/nav-defaults";
import { Breadcrumbs, DemoBar, EnvBadge, Sheet, Standalone, useDocumentLang, type Crumb } from "@/ui/kit";
import { useRegisteredCommands } from "@/ui/kit/paletteContext";
import { AletheiaDock, AletheiaProvider, AppShell, CommandPalette, SheetHost, ToastHost, useAletheia } from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";
import { Banners, FailedJobLine, HealthWord, usePaletteSearch, ViewAsSheet } from "@/ui/shell/parts";
import { envOf, LocaleClock, NotificationsBell, searchHint, SystemSwitcher, useCurrentSystem } from "@/ui/shell/global";
import { useV2Session } from "@/lib/v2/hooks";

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
  const router = useRouter();
  const [palette, setPalette] = useState(false);
  const screen = useRegisteredCommands();
  const [q, setQ] = useState("");
  const found = usePaletteSearch(palette ? q : "");
  const [viewAs, setViewAs] = useState(false);
  const session = useV2Session();
  const [keys, setKeys] = useState(false);
  const { current: system } = useCurrentSystem();
  const env = envOf(system);
  const [hint, setHint] = useState("Ctrl K"); // i18n-ignore
  useEffect(() => { const id = window.setTimeout(() => setHint(searchHint()), 0); return () => window.clearTimeout(id); }, []);
  const menu = [
    { id: "profile", label: t("Profile and preferences"), onClick: () => router.push(withFixture("/me", fx)) },
    // The top-bar health word and bell hide at phone width, so the menu carries both.
    { id: "inbox", label: t("Inbox"), onClick: () => router.push(withFixture("/me/notifications", fx)) },
    { id: "status", label: t("Platform status"), onClick: () => router.push("/status") },
    ...(session.can("manage_users") && !session.viewAs && !session.shared ? [{ id: "view-as", label: t("View as a role"), onClick: () => setViewAs(true) }] : []),
    { id: "keys", label: t("Keyboard shortcuts"), onClick: () => setKeys(true) },
    ...(fx ? [] : [{ id: "out", label: t("Sign out"), onClick: logout }]),
  ];
  useEffect(() => {
    // "g" then a letter jumps to a place, as in the old interface. The chord lapses after 1.2 seconds.
    const CHORDS: Record<string, string> = { h: PATHS.home, l: PATHS.load, r: PATHS.runs, m: "/monitor", u: "/rules", c: PATHS.work, o: "/o", k: "/insights", a: PATHS.more };
    let armed = 0;
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); return; }
      const el = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "")) return;
      const key = e.key.toLowerCase();
      if (armed && Date.now() - armed < 1200 && CHORDS[key]) { armed = 0; e.preventDefault(); router.push(withFixture(CHORDS[key], fx)); return; }
      if (key === "?") { e.preventDefault(); setKeys(true); return; }
      armed = key === "g" ? Date.now() : 0;
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [router, fx]);
  // Primary tabs. Everything else is in MORE, the palette and the chords.
  const sections = [
    { id: "home", label: t("Home"), href: "/" },
    { id: "objects", label: t("Objects"), href: "/o" },
    { id: "clean", label: t("Clean"), href: PATHS.work },
    { id: "load", label: t("Load"), href: PATHS.load },
    { id: "monitor", label: t("Monitor"), href: "/monitor" },
  ].map((s) => ({ ...s, href: link(s.href), active: s.href === "/" ? path === "/" : path.startsWith(s.href) }));
  const moreItems = [
    { id: "runs", label: t("Runs"), href: PATHS.runs },
    { id: "insights", label: t("Insights"), href: "/insights" },
    { id: "rules", label: t("Rules"), href: "/rules" },
    { id: "mdm", label: t("MDM"), href: "/mdm" },
    { id: "systems", label: t("Systems"), href: "/s" },
    { id: "people", label: t("People"), href: "/people" },
    { id: "requests", label: t("Requests"), href: "/requests" },
    { id: "approvals", label: t("Approvals"), href: "/approvals" },
    { id: "reports", label: t("Reports"), href: "/reports" },
    { id: "admin", label: t("Admin"), href: PATHS.more },
  ].map((m) => ({ ...m, href: link(m.href) }));
  const commands = [
    ...[...sections, ...moreItems].map((s) => ({ id: s.id, label: t("Go to {place}", { place: s.label }), group: t("Go to"), run: () => router.push(s.href) })),
    { id: "act-keys", label: t("Keyboard shortcuts"), group: t("Actions"), run: () => setKeys(true) },
    { id: "act-status", label: t("Platform status"), group: t("Actions"), run: () => router.push("/status") },
  ];
  const chords: [string, string][] = [["g h", t("Home")], ["g o", t("Objects")], ["g c", t("Clean")], ["g l", t("Load")], ["g m", t("Monitor")], ["g r", t("Runs")], ["g u", t("Rules")], ["g k", t("Insights")], ["g a", t("Admin")], [hint, t("Jump to")], ["?", t("Keyboard shortcuts")]];
  const here = [...sections, ...moreItems].find((s) => path !== "/" && path.startsWith(new URL(s.href, "http://x").pathname));
  const crumbs: Crumb[] = path === "/" ? [{ label: t("Home") }] : [{ label: t("Home"), href: link("/") }, ...(here ? [{ label: here.label, href: system ? here.href : undefined }] : []), ...(system ? [{ label: system.name }] : [])];
  return (
    <>
    <AppShell
      brand={t("Meridian")}
      sections={sections}
      navLabel={t("Main sections")}
      skipLabel={t("Skip to content")}
      skipNavLabel={t("Skip links")}
      context={<SystemSwitcher />}
      environment={env ? <EnvBadge environment={system?.environment} title={env === "PROD" ? t("Production system") : env === "QA" ? t("Quality assurance system") : t("Development system")} /> : null}
      prod={env === "PROD"}
      locale={<LocaleClock />}
      menuExtra={<><div className="mx-phone-only"><SystemSwitcher /></div><div className="mx-narrow-only"><LocaleClock inMenu /></div></>}
      crumbs={<Breadcrumbs items={crumbs} label={t("Breadcrumb")} collapsedLabel={t("Hidden levels")} />}
      user={{ name: user?.name ?? user?.email ?? t("Demo user"), email: user?.email, meta: [session.label] }}
      userMenuLabel={t("Account menu")}
      menu={menu}
      more={{ label: t("More"), items: moreItems }}
      search={{ label: t("Jump to"), hint, onOpen: () => setPalette(true) }}
      dock={chat.open ? null : (
        <AletheiaDock
          scope={chat.scope?.label ?? t("Asking about the whole landscape")}
          placeholder={t("Ask Aletheia about this page")}
          inputLabel={t("Ask a question")}
          send={t("Send")}
          onOpen={() => chat.setOpen(true)}
          onAsk={(q) => { chat.setOpen(true); chat.ask(q); }}
        />
      )}
      banner={<><Banners /><FailedJobLine /></>}
      actions={<><HealthWord /><NotificationsBell /></>}
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
    <CommandPalette
      open={palette}
      onClose={() => { setPalette(false); setQ(""); }}
      commands={commands}
      context={screen.commands}
      contextLabel={screen.label}
      onQuery={setQ}
      extra={found}
      onAsk={(q) => { chat.setOpen(true); chat.ask(q); }}
      label={t("Command palette")}
      placeholder={t("Go to a screen or ask Aletheia")}
      askLabel={(q) => t("Ask Aletheia: {q}", { q })}
      emptyLabel={t("No matches")}
      askGroup={t("Ask Aletheia")}
      recentLabel={t("Recent")}
      footer={[t("Up and down to move"), t("Enter to open"), t("Escape to close")]}
    />
    <Sheet open={keys} onClose={() => setKeys(false)} label={t("Keyboard shortcuts")} closeLabel={t("Close")}>
      <dl className="mx-keys">{chords.map(([k, l]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{l}</dd></div>)}</dl>
    </Sheet>
    <ViewAsSheet open={viewAs} onClose={() => setViewAs(false)} />
    </>
  );
}

/** The shell root: tokens, and the interface language on the root and on <html> (WCAG 3.1.1). */
function Root({ children }: { children: ReactNode }) {
  const { tag } = useInterfaceLang();
  useDocumentLang(tag);
  return <div className="mx-root" lang={tag}>{children}</div>;
}

/** Same sign-in and permissions chain as the current app; fixture mode skips sign-in. */
export function Frame({ children }: { children: ReactNode }) {
  const fx = useFixture();
  const path = usePathname() ?? "";
  // The status page and share links are public: no sign-in, no navigation.
  if (path === "/status" || path.startsWith("/share/")) {
    return <Standalone><Suspense fallback={null}><ToastHost><SheetHost sheets={SHEETS} closeLabel={t("Close")}>{children}</SheetHost></ToastHost></Suspense></Standalone>;
  }
  const inner = <Suspense fallback={null}><ChatHost><ToastHost><SheetHost sheets={SHEETS} closeLabel={t("Close")}><Shell>{children}</Shell></SheetHost></ToastHost></ChatHost></Suspense>;
  if (fx) return <Root><DemoBar />{inner}</Root>;
  return (
    <AuthGuard>
      <PermissionsProvider>
        <PreferencesSync />
        <Root>{inner}</Root>
        <RequestAccessHost />
      </PermissionsProvider>
    </AuthGuard>
  );
}
