"use client";

import { useParams } from "next/navigation";
import { RunCanvas } from "@/design/v2/screens/Run";
import { RunDetail } from "@/design/next/runs/RunDetail";
import { useUiNext } from "@/design/next/useUiNext";

export default function RunPage() {
  const { id } = useParams<{ id: string }>();
  return useUiNext() ? <RunDetail id={String(id)} /> : <RunCanvas id={String(id)} />;
}
