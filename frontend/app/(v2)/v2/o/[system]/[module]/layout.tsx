import type { ReactNode } from "react";
import { ObjectRouteFrame } from "@/design/v2/screens/routes";

export default function ObjectLayout({ children }: { children: ReactNode }) {
  return <ObjectRouteFrame>{children}</ObjectRouteFrame>;
}
