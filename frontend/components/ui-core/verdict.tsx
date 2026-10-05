import type { ReactNode } from "react";

/** The one sentence a page states about itself. One per page. */
export function Verdict({ children }: { children: ReactNode }) {
  return <p className="ui-verdict">{children}</p>;
}
