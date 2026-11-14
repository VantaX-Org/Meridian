"use client";

import { useParams } from "next/navigation";
import { CompareCanvas } from "@/design/v2/screens/Compare";
import { ComparePage } from "@/design/next/runs/CompareSheet";
import { useUiNext } from "@/design/next/useUiNext";

export default function ComparePageRoute() {
  const { id, b } = useParams<{ id: string; b: string }>();
  return useUiNext() ? <ComparePage a={String(id)} b={String(b)} /> : <CompareCanvas a={String(id)} b={String(b)} />;
}
