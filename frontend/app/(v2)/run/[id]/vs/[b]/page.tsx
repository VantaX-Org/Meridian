"use client";

import { useParams } from "next/navigation";
import { CompareCanvas } from "@/design/v2/screens/Compare";

export default function ComparePage() {
  const { id, b } = useParams<{ id: string; b: string }>();
  return <CompareCanvas a={String(id)} b={String(b)} />;
}
