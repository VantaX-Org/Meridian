"use client";

import { useParams } from "next/navigation";
import { Load } from "@/design/next/screens/Load";
import { isLoadTab } from "@/design/next/load/tabs";

export default function Page() {
  const p = useParams<{ tab?: string[] }>();
  const tab = p.tab?.[0];
  return <Load tab={isLoadTab(tab) ? tab : "prepare"} />;
}
