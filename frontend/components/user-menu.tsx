"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { Mono, Pill, IconCheck, IconGear, IconLogOut, IconMonitor, IconMoon, IconSun, type Icon } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useAuroraPrefs, type Theme } from "@/hooks/use-theme";

const THEMES: { value: Theme; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "system", label: "System", icon: IconMonitor },
  { value: "dark", label: "Dark", icon: IconMoon },
];

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const src = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? email).slice(0, 2);
  return src.toUpperCase();
}

/** Top-bar account menu: identity, theme control, sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useAuroraPrefs();
  if (!user) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account menu"
        className="m-motion-colors inline-flex items-center justify-center rounded-full m-text-label font-semibold"
        style={{ width: 28, height: 28, background: "var(--m-accent-soft)", color: "var(--m-accent-ink)" }}
      >
        {initials(user.name, user.email)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="m-elev-2 m-motion-scale-in" style={{ width: 240, background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", padding: 4 }}>
            <div className="flex flex-col gap-1 px-3 py-2">
              <span className="m-text-body font-medium truncate" style={{ color: "var(--m-ink)" }}>{user.name}</span>
              <span className="m-text-meta truncate" style={{ color: "var(--m-ink-3)" }}><Mono>{user.email}</Mono></span>
              <span><Pill tone="neutral">{user.role}</Pill></span>
            </div>
            <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--m-line)" }} />
            <div className="px-3 pt-2 m-text-meta" style={{ color: "var(--m-ink-3)" }}>Theme</div>
            <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <Menu.RadioItem
                  key={value}
                  value={value}
                  closeOnClick={false}
                  className="m-motion-colors flex cursor-pointer items-center gap-2 px-3 m-text-body data-[highlighted]:bg-[var(--m-sheet-raised)]"
                  style={{ height: 32, color: "var(--m-ink)", borderRadius: "var(--m-radius-pill)" }}
                >
                  <Icon size={14} aria-hidden style={{ color: "var(--m-ink-3)" }} />
                  <span className="flex-1">{label}</span>
                  <Menu.RadioItemIndicator><IconCheck size={14} style={{ color: "var(--m-accent)" }} /></Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--m-line)" }} />
            <Menu.Item
              render={<Link href="/me/preferences" />}
              className="m-motion-colors flex cursor-pointer items-center gap-2 px-3 m-text-body data-[highlighted]:bg-[var(--m-sheet-raised)]"
              style={{ height: 32, color: "var(--m-ink)", borderRadius: "var(--m-radius-pill)" }}
            >
              <IconGear size={14} style={{ color: "var(--m-ink-3)" }} />
              Preferences
            </Menu.Item>
            <Menu.Item
              onClick={logout}
              className="m-motion-colors flex cursor-pointer items-center gap-2 px-3 m-text-body data-[highlighted]:bg-[var(--m-sheet-raised)]"
              style={{ height: 32, color: "var(--m-ink)", borderRadius: "var(--m-radius-pill)" }}
            >
              <IconLogOut size={14} style={{ color: "var(--m-ink-3)" }} />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
