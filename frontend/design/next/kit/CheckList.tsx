"use client";

import type { ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { cx } from "./cx";

export type CheckLevel = "pass" | "warn" | "block";
export interface CheckResult {
  code: string;
  level: CheckLevel;
  /** One sentence, already translated. */
  text: string;
  fix?: { label: string; href?: string; onClick?: () => void };
}

const LEVEL: Record<CheckLevel, () => string> = { pass: () => t("Passed"), warn: () => t("Warning"), block: () => t("Blocked") };

/** Check results as rows: a tone dot (with its word for screen readers), the sentence, and a way to fix it. */
export function CheckList({ checks, label, className, ...rest }: { checks: CheckResult[]; label?: string; className?: string } & Record<`data-${string}`, string | undefined>): ReactNode {
  return (
    <ul className={cx("nx-checks", className)} aria-label={label ?? t("Checks")} {...rest}>
      {checks.map((c) => (
        <li key={c.code} className="nx-check" data-level={c.level}>
          <span className="nx-check-dot" aria-hidden="true" />
          <span className="nx-sr">{LEVEL[c.level]()}</span>
          <span className="nx-check-text">{c.text}</span>
          {c.fix ? (
            c.fix.href ? <a className="nx-check-fix" href={c.fix.href}>{c.fix.label}</a>
              : <button type="button" className="nx-check-fix" onClick={c.fix.onClick}>{c.fix.label}</button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
