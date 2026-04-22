/**
 * Aurora <Banner> primitive — WS2.
 *
 * Status strip rendered above the content. One banner per viewport — stacks
 * are a code smell. `tone` maps to the semantic status tokens; icon is
 * optional but recommended for screen-reader parity with the visual tone.
 */

import type { ReactNode } from "react";
import { clsx } from "./internal";

export type BannerTone = "neutral" | "success" | "warning" | "danger" | "info";

export interface BannerProps {
  tone?: BannerTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const ROLE_BY_TONE: Record<BannerTone, "status" | "alert"> = {
  neutral: "status",
  info: "status",
  success: "status",
  warning: "status",
  danger: "alert",
};

export function Banner({
  tone = "neutral",
  icon,
  title,
  children,
  action,
  className,
}: BannerProps) {
  return (
    <div
      className={clsx("aurora-banner", className)}
      data-tone={tone === "neutral" ? undefined : tone}
      role={ROLE_BY_TONE[tone]}
    >
      {icon ? <span className="aurora-banner__icon">{icon}</span> : null}
      <div className="aurora-banner__body">
        {title ? <span className="aurora-banner__title">{title}</span> : null}
        {children ? (
          <span className="aurora-banner__description">{children}</span>
        ) : null}
      </div>
      {action}
    </div>
  );
}
