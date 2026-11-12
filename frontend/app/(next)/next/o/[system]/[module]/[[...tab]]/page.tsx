"use client";

import { useParams } from "next/navigation";
import { ObjectPage } from "@/design/next/screens/ObjectPage";
import { isTab } from "@/design/next/object/tabs";

export default function Page() {
  const p = useParams<{ system: string; module: string; tab?: string[] }>();
  const tab = p.tab?.[0];
  return <ObjectPage system={String(p.system)} module={String(p.module)} tab={isTab(tab) ? tab : "cycle"} />;
}
