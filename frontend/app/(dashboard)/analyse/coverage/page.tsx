"use client";

import { Suspense } from "react";
import { RuleCoverage } from "@/components/analyse/coverage";

export default function Page() {
  return <Suspense><RuleCoverage /></Suspense>;
}
