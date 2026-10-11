import type { ReactNode } from "react";
import { clsx } from "clsx";

export function Mono({ children, inline = false }: { children: ReactNode; inline?: boolean }) {
  return <span className={clsx("m-mono", inline && "m-mono-inline")}>{children}</span>;
}
