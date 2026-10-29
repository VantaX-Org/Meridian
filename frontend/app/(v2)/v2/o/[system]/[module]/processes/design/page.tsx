"use client";

import { useParams } from "next/navigation";
import { ProcessDesigner } from "@/design/v2/screens/ProcessDesigner";

export default function ProcessDesignerPage() {
  const p = useParams<{ system: string; module: string }>();
  return <ProcessDesigner system={String(p.system)} module={String(p.module)} />;
}
