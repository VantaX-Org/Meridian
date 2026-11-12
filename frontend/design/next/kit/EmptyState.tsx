"use client";

import type { ReactNode } from "react";
import { Icon, type IconName } from "../Icon";

/** Icon, heading, one sentence, one button. The button is passed in so it can be a link or a Button. */
export function EmptyState({ icon = "inbox", heading, children, action }: { icon?: IconName; heading: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="nx-empty">
      <span className="nx-empty-icon" aria-hidden="true"><Icon name={icon} size={28} /></span>
      <h3 className="nx-empty-h">{heading}</h3>
      {children ? <p className="nx-empty-p">{children}</p> : null}
      {action}
    </div>
  );
}
