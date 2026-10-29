import type { CSSProperties, ReactNode } from "react";

/**
 * A framed table that may scroll sideways on a phone. The frame is a labelled region the keyboard can reach, so the
 * hidden part of a wide table is never out of reach of someone who does not use a pointer.
 */
export function ScrollFrame({ label, children, style }: { label: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="m2-frame m2-rframe" role="region" aria-label={label} tabIndex={0} style={style}>
      {children}
    </div>
  );
}
