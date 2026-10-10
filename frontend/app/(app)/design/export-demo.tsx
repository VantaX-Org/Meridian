"use client";

import { ExportMenu } from "@/design";

/** Client wrapper: ExportMenu options carry `run` functions, which a server page cannot pass down. */
export function ExportDemo() {
  return (
    <ExportMenu
      options={[
        { format: "xlsx", run: () => Promise.resolve() },
        { format: "csv", run: () => Promise.resolve() },
      ]}
    />
  );
}
