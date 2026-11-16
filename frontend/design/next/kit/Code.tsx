"use client";

import type { ReactNode } from "react";

// SAP's own notation for a field, TABLE-FIELD (MARA-MEINS), whatever the API sent (MARA.MEINS).
const SAP_FIELD = /^\/?[A-Z][A-Z0-9_/]{2,}\.[A-Z][A-Z0-9_/]+$/;

/** A code, always with its text beside it (rule, field, value, plant). The code is mono; the text is not. */
export function Code({ code, text, children }: { code: string; text?: ReactNode; children?: ReactNode }) {
  const shown = SAP_FIELD.test(code) ? code.replace(".", "-") : code;
  const words = text ?? children;
  return (
    <span className="nx-code-pair">
      <code className="nx-code">{shown}</code>
      {words && words !== code ? <span className="nx-code-text">{words}</span> : null}
    </span>
  );
}
