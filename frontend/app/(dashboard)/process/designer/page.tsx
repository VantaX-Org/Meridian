"use client";

import { Suspense } from "react";
import { ProcessDesigner } from "@/components/process/designer/page";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProcessDesigner />
    </Suspense>
  );
}
