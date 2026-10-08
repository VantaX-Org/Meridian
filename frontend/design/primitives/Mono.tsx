import type { ReactNode } from "react";

export function Mono({ children }: { children: ReactNode }) {
  return <span style={{ fontFamily: "var(--m-font-mono)" }}>{children}</span>;
}
