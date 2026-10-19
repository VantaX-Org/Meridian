"use client";

import { Breadcrumb } from "./Breadcrumb";
import { Suspense, type ReactNode } from "react";

/**
 * The scope bar under the index bar: the page's single h1 (the Breadcrumb) with the crumbs and scope parts a
 * page publishes beside it, and on the right whatever the layout passes (the scoped-access pill). On a page
 * that draws its own title and publishes nothing, the bar collapses to nothing but the hidden h1 (CSS :has).
 */
export function TopBar({ trailing }: { trailing?: ReactNode }) {
  return (
    <div className="m-scopebar m-print-hide">
      <Suspense fallback={null}>
        <Breadcrumb />
      </Suspense>
      <div className="m-scopebar-trailing">{trailing}</div>
    </div>
  );
}
