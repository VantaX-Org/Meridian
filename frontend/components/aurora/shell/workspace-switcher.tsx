/**
 * Aurora <WorkspaceSwitcher> — WS4.
 *
 * Four square tiles stacked in the 48 px rail, one per workspace (Command
 * Centre / Workbench / Process / Admin). Each tile is keyboard-reachable
 * with ⌘1 … ⌘4 (Meta on macOS, Alt on Windows/Linux by native convention —
 * consumer owns the binding; this primitive exposes the shortcut label
 * only).
 *
 * Active workspace renders the inset accent rail on the left edge. Tile
 * hover reveals a tooltip with the workspace label + shortcut.
 */

"use client";

import type { ReactNode } from "react";
import { clsx } from "../primitives/internal";

export type WorkspaceId =
  | "command-centre"
  | "workbench"
  | "process"
  | "admin";

export interface WorkspaceSwitcherItem {
  id: WorkspaceId;
  label: string;
  icon: ReactNode;
  /** Shortcut label, e.g. "⌘1". Rendered in tooltip only; binding happens
      elsewhere (consumers wire the actual keystroke via CommandPalette). */
  shortcut?: string;
  /** URL for the workspace root — drives href on the tile. */
  href: string;
}

export interface WorkspaceSwitcherProps {
  items: ReadonlyArray<WorkspaceSwitcherItem>;
  /** ID of the currently active workspace. */
  active?: WorkspaceId;
  /** Link renderer — defaults to a plain <a>. Next.js consumers pass `<Link>`. */
  renderLink?: (props: {
    href: string;
    children: ReactNode;
    className: string;
    "aria-current"?: "page";
    "aria-label": string;
    title: string;
  }) => ReactNode;
  className?: string;
}

export function WorkspaceSwitcher({
  items,
  active,
  renderLink,
  className,
}: WorkspaceSwitcherProps) {
  return (
    <nav
      className={clsx("aurora-workspace-switcher", className)}
      aria-label="Workspaces"
    >
      <ul>
        {items.map((item) => {
          const isActive = item.id === active;
          const tileClassName = clsx(
            "aurora-workspace-switcher__tile",
            "aurora-focus-ring",
          );
          const ariaLabel = `${item.label}${
            item.shortcut ? ` (${item.shortcut})` : ""
          }`;
          const title = ariaLabel;
          const content = <span className="aurora-workspace-switcher__icon">{item.icon}</span>;
          const linkProps = {
            href: item.href,
            children: content,
            className: tileClassName,
            "aria-label": ariaLabel,
            title,
            ...(isActive ? { "aria-current": "page" as const } : {}),
          };
          return (
            <li key={item.id} data-active={isActive ? "true" : undefined}>
              {renderLink ? renderLink(linkProps) : <a {...linkProps}>{content}</a>}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
