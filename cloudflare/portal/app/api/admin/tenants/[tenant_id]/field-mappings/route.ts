import { requireAdmin } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

type Params = Promise<{ tenant_id: string }>;

export async function GET(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdmin(request);
  if (authErr) return authErr;
  const { tenant_id } = await params;
  const qs = request.nextUrl.searchParams.toString();
  const resp = await fetch(
    `${WORKER_URL}/api/admin/tenants/${tenant_id}/field-mappings${qs ? `?${qs}` : ""}`,
    { headers: { "X-Admin-Secret": ADMIN_SECRET }, cache: "no-store" }
  );
  return NextResponse.json(await resp.json(), { status: resp.status });
}

export async function PUT(request: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdmin(request);
  if (authErr) return authErr;
  const { tenant_id } = await params;
  const body = await request.json();
  const resp = await fetch(
    `${WORKER_URL}/api/admin/tenants/${tenant_id}/field-mappings`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
      body: JSON.stringify(body),
    }
  );
  return NextResponse.json(await resp.json(), { status: resp.status });
}
