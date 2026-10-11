import type { ReactNode } from "react";
import Link from "next/link";

/** A number cell that drills to its evidence. Row-click safe. Use DrillLink when the target is an object. */
export function NumLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="m-numeric underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
      {children}
    </Link>
  );
}
