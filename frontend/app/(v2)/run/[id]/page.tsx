"use client";

import { useParams } from "next/navigation";
import { RunCanvas } from "@/design/v2/screens/Run";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  return <RunCanvas id={String(id)} />;
}
