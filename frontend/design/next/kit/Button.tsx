"use client";

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { t } from "@/lib/v2/i18n";
import { Icon, type IconName } from "../Icon";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "disabled"> {
  /** Primary: filled accent pill. Secondary: outlined. Quiet: text. Danger: outlined in the bad colour. */
  variant?: ButtonVariant;
  /** 32 or 40 px high. */
  size?: 32 | 40;
  /** Swaps the label for a 16 px spinner and keeps the width. */
  loading?: boolean;
  loadingLabel?: string;
  /** A disabled button says why, in words beside it. */
  disabled?: boolean;
  reason?: ReactNode;
  icon?: IconName;
}

/**
 * The button. A disabled or loading button stays focusable (aria-disabled) so its reason is read; the click is
 * swallowed. Exactly one primary per screen is the rule of the checklist, not enforced here.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = 40, loading = false, loadingLabel, disabled = false, reason, icon, children, onClick, type = "button", ...rest },
  ref,
) {
  const reasonId = useId();
  const inert = disabled || loading;
  const showReason = disabled && !!reason;
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={cx("nx-btn", `nx-btn-${variant}`, size === 32 && "nx-btn-sm")}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      aria-describedby={showReason ? reasonId : rest["aria-describedby"]}
      onClick={(e) => {
        if (inert) return e.preventDefault();
        onClick?.(e);
      }}
    >
      <span className="nx-btn-label" data-hidden={loading || undefined}>
        {icon ? <Icon name={icon} /> : null}
        {children}
      </span>
      {loading ? (
        <>
          <span className="nx-btn-spin nx-spinner" aria-hidden="true"><Icon name="loader" /></span>
          <span className="nx-sr">{loadingLabel ?? t("Loading")}</span>
        </>
      ) : null}
    </button>
  );
  if (!showReason) return button;
  return (
    <span className="nx-btn-wrap">
      {button}
      <span id={reasonId} className="nx-reason">{reason}</span>
    </span>
  );
});
