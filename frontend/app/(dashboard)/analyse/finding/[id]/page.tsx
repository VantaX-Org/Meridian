"use client";

import { use } from "react";
import { FindingDetailPage } from "@/components/command-centre/finding-detail";

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <FindingDetailPage id={id} />;
}
