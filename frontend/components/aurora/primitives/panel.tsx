/**
 * Aurora <Panel> — elevation-1 section surface with a title row.
 */

import type { ReactNode } from "react";
import { clsx } from "./internal";
import { Stack } from "./stack";
import { Text } from "./text";

export interface PanelProps {
  title?: ReactNode;
  /** Right side of the title row (actions, filters). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, action, children, className }: PanelProps) {
  return (
    <section
      className={clsx(
        "rounded-lg border border-[var(--aurora-canvas-line)] bg-[var(--aurora-elev-1-bg)] p-[var(--aurora-space-5)] shadow-[var(--aurora-elev-1-shadow)]",
        className
      )}
    >
      {(title || action) && (
        <Stack direction="row" justify="between" align="center" gap={3} className="mb-[var(--aurora-space-4)]">
          {title ? <Text variant="text-lead">{title}</Text> : <span />}
          {action}
        </Stack>
      )}
      {children}
    </section>
  );
}
