"use client";

import type { ReactNode } from "react";

/** A code, always with its text beside it (rule, field, value, plant). The code is mono; the text is not. */
export function Code({ code, text, children }: { code: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <span className="nx-code-pair">
      <code className="nx-code">{code}</code>
      {text || children ? <span className="nx-code-text">{text ?? children}</span> : null}
    </span>
  );
}
