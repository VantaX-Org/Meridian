"use client";

import { useParams } from "next/navigation";
import { SystemCanvas } from "@/design/v2/screens/System";

export default function SystemPage() {
  const { id } = useParams<{ id: string }>();
  return <SystemCanvas id={String(id)} />;
}
