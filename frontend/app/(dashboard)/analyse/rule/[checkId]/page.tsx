"use client";

import { Suspense, use } from "react";
import { RuleDetailPage } from "@/components/analyse/rule-detail";

export default function Page({ params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = use(params);
  return <Suspense><RuleDetailPage checkId={decodeURIComponent(checkId)} /></Suspense>;
}
