"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/aurora";
import { RecordReportView } from "@/components/workbench/record-report";

function Inner() {
  const issue = useSearchParams().get("issue");
  return issue ? <RecordReportView issueId={issue} /> : <EmptyState title="Open a record from the triage table to see its report." />;
}

export default function RecordReportPage() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
