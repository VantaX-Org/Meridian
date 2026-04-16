import { getTenant } from "@/lib/admin-api";
import { notFound } from "next/navigation";
import TenantDetailClient from "./TenantDetailClient";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ tenant_id: string }>;
}) {
  const { tenant_id } = await params;

  let tenant;
  try {
    tenant = await getTenant(tenant_id);
  } catch {
    notFound();
  }

  return <TenantDetailClient tenant={tenant} />;
}
