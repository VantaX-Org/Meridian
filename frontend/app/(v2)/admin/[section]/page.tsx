"use client";

import { useParams } from "next/navigation";
import { AdminCanvas } from "@/design/v2/admin/Admin";

export default function AdminSectionPage() {
  const { section } = useParams<{ section: string }>();
  return <AdminCanvas section={String(section)} />;
}
