import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import "@/design/v2/print.css";
import { V2Shell } from "@/design/v2/shell/V2Shell";

export const metadata: Metadata = { title: "Load" };

// The next shell (app/(next)/layout.tsx) is the frame here; V2Shell under it renders only the v2 token scope.
export default function LoadLayout({ children }: { children: ReactNode }) {
  return (
    <div className="m2-fonts">
      <Suspense fallback={<div className="m2-boot" aria-hidden="true" />}>
        <V2Shell>{children}</V2Shell>
      </Suspense>
    </div>
  );
}
