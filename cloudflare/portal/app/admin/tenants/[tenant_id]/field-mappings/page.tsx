import { getTenant, getTenantFieldMappings } from "@/lib/admin-api";
import { notFound } from "next/navigation";
import FieldMappingsClient from "./FieldMappingsClient";

export default async function FieldMappingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant_id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { tenant_id } = await params;
  const sp = await searchParams;
  const module = sp.module || "";

  let tenant;
  let fieldMappings;
  try {
    [tenant, fieldMappings] = await Promise.all([
      getTenant(tenant_id),
      getTenantFieldMappings(tenant_id, module || undefined),
    ]);
  } catch {
    notFound();
  }

  return (
    <FieldMappingsClient
      tenant={tenant}
      initialMappings={fieldMappings.field_mappings}
      currentModule={module}
    />
  );
}
