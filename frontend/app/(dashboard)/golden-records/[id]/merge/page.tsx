"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { WhyMergedPanel } from "@/components/mdm/why-merged-panel";

export default function GoldenRecordMergePage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-4 p-4">
      <Link href={`/golden-records/${id}`} className="inline-flex items-center gap-1 text-sm"
        style={{ color: "var(--aurora-fg-secondary)" }}>
        <ArrowLeft className="h-4 w-4" /> Back to golden record
      </Link>
      <WhyMergedPanel recordId={id} />
    </div>
  );
}
