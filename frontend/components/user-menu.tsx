"use client";

import { Menu } from "@base-ui/react/menu";
import { LogOut } from "lucide-react";
import { Mono, Pill } from "@/design";
import { useAuth } from "@/context/auth-context";
import { ThemeToggle } from "@/components/theme-toggle";

function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const src = parts.length > 1 ? parts[0]![0]! + parts[parts.length - 1]![0]! : (parts[0] ?? email).slice(0, 2);
  return src.toUpperCase();
}

/** Top-bar account menu: identity, theme control, sign out. */
export function UserMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Account menu"
        className="m-motion-colors inline-flex items-center justify-center rounded-full text-[11px] leading-[14px] font-semibold"
        style={{ width: 28, height: 28, background: "var(--m-accent-soft)", color: "var(--m-accent-ink)" }}
      >
        {initials(user.name, user.email)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={8} className="z-50">
          <Menu.Popup className="m-elev-2 m-motion-scale-in" style={{ width: 240, background: "var(--m-sheet)", borderRadius: "var(--m-radius-sheet)", padding: 4 }}>
            <div className="flex flex-col gap-1 px-3 py-2">
              <span className="text-[13px] leading-[18px] font-medium truncate" style={{ color: "var(--m-ink)" }}>{user.name}</span>
              <span className="text-[12px] leading-[16px] truncate" style={{ color: "var(--m-ink-3)" }}><Mono>{user.email}</Mono></span>
              <span><Pill tone="neutral">{user.role}</Pill></span>
            </div>
            <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--m-line)" }} />
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[12px] leading-[16px]" style={{ color: "var(--m-ink-3)" }}>Theme</span>
              <ThemeToggle />
            </div>
            <div role="separator" style={{ height: 1, margin: "4px 0", background: "var(--m-line)" }} />
            <Menu.Item
              onClick={logout}
              className="m-motion-colors flex cursor-pointer items-center gap-2 px-3 text-[13px] leading-[18px] data-[highlighted]:bg-[var(--m-sheet-raised)]"
              style={{ height: 32, color: "var(--m-ink)", borderRadius: "var(--m-radius-control)" }}
            >
              <LogOut size={14} aria-hidden style={{ color: "var(--m-ink-3)" }} />
              Sign out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
