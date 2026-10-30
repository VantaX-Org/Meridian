import type { Metadata } from "next";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import { StandaloneRoot } from "@/design/v2/shell/Standalone";


export const metadata: Metadata = {
  title: "Status",
  description: "Whether the platform is working: its components, the last 30 days, incidents and planned maintenance",
};

/** Pages that stand without the shell: the status page at /status, readable signed out. */
export default function StandaloneLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="m2-fonts">
      <StandaloneRoot>{children}</StandaloneRoot>
    </div>
  );
}
