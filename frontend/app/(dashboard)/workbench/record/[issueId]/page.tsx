"use client";

import { use } from "react";
import { RecordReportView } from "@/components/workbench/record-report";

export default function Page({ params }: { params: Promise<{ issueId: string }> }) {
  const { issueId } = use(params);
  return <RecordReportView issueId={issueId} />;
}
