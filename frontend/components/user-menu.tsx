"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { Pill, IconCheck, IconGear, IconLogOut, IconMonitor, IconMoon, IconSun, type Icon } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useAuroraPrefs, type Theme } from "@/hooks/use-theme";

const THEMES: { value: Theme; label: string; icon: Icon }[] = [
  { value: "light", label: "Light", icon: IconSun },
  { value: "system", label: "System", icon: IconMonitor },
  { value: "dark", label: "Dark", icon: IconMoon },
];

/** `.m-popup-item` with the icon and label packed to the start. */
const ITEM = "m-popup-item justify-start";
const SEPARATOR = "my-1 h-px [background:var(--m-line)]";

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
        className="m-motion-colors inline-flex size-7 items-center justify-center rounded-full m-text-label font-semibold m-ink-accent-ink [background:var(--m-accent-soft)]"
      >
        {initials(user.name, user.email)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="m-popup w-60">
            <div className="flex flex-col gap-1 px-2.5 py-2">
              <span className="m-text-body font-medium truncate m-ink">{user.name}</span>
              <span className="m-text-meta truncate m-ink-3">{user.email}</span>
              <span><Pill tone="neutral">{user.role}</Pill></span>
            </div>
            <Menu.Separator className={SEPARATOR} />
            <div className="px-2.5 pt-2 pb-1 m-text-meta m-ink-3">Theme</div>
            <Menu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
              {THEMES.map(({ value, label, icon: Icon }) => (
                <Menu.RadioItem key={value} value={value} closeOnClick={false} className={ITEM}>
                  <Icon size={14} aria-hidden className="m-ink-3" />
                  <span className="flex-1">{label}</span>
                  <Menu.RadioItemIndicator><IconCheck size={14} className="m-ink-accent" /></Menu.RadioItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <Menu.Separator className={SEPARATOR} />
            <Menu.Item render={<Link href="/me/preferences" />} className={ITEM}>
              <IconGear size={14} aria-hidden className="m-ink-3" />
              Preferences
            </Menu.Item>
            <Menu.Item onClick={logout} className={ITEM}>
              <IconLogOut size={14} aria-hidden className="m-ink-3" />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
