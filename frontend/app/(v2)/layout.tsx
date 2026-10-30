import type { Metadata } from "next";
import "@/design/v2/tokens.css";
import "@/design/v2/v2.css";
import "@/design/v2/admin.css";
import "@/design/v2/status.css";
import "@/design/v2/print.css";
import { V2Shell } from "@/design/v2/shell/V2Shell";


export const metadata: Metadata = {
  title: { absolute: "Meridian" },
  description: "The SAP landscape as one map: every system and object scored, every fix in one place",
};

export default function V2Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="m2-fonts">
      <V2Shell>{children}</V2Shell>
    </div>
  );
}
