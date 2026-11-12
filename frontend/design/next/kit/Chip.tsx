"use client";

import type { ReactNode } from "react";
import { formatInt as int } from "@/lib/format";
import { Icon, type IconName } from "../Icon";
import { cx } from "./cx";

export type ChipTone = "neutral" | "accent" | "new" | "resolved" | "regressed" | "good" | "warn" | "bad" | "aletheia";

/** Shape and word, never colour alone: each tone has its own icon, and the label is always there. */
const TONE_ICON: Partial<Record<ChipTone, IconName>> = {
  new: "plus",
  resolved: "check",
  regressed: "arrow-down",
  good: "check",
  warn: "alert",
  bad: "x",
  aletheia: "sparkles",
};

export interface ChipProps {
  tone?: ChipTone;
  /** A count chip ("12 new"): the number comes first, the label follows. */
  count?: number;
  children?: ReactNode;
  /** Makes the chip a button (a filter). */
  onClick?: () => void;
  pressed?: boolean;
}

export function Chip({ tone = "neutral", count, children, onClick, pressed }: ChipProps) {
  const icon = TONE_ICON[tone];
  const body = (
    <>
      {icon ? <Icon name={icon} /> : null}
      {count !== undefined ? <span className="nx-chip-count">{int(count)}</span> : null}
      {children ? <span>{children}</span> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={cx("nx-chip", "nx-chip-btn", `nx-chip-${tone}`)} aria-pressed={pressed} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <span className={cx("nx-chip", `nx-chip-${tone}`)}>{body}</span>;
}
