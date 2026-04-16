import { requireAdmin } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

type Params = Promise<{ tenant_id: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdmin(_req);
  if (authErr) return authErr;
  const { tenant_id } = await params;
  const resp = await fetch(`${WORKER_URL}/api/admin/tenants/${tenant_id}`, {
    headers: { "X-Admin-Secret": ADMIN_SECRET },
    cache: "no-store",
  });
  return NextResponse.json(await resp.json(), { status: resp.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdmin(req);
  if (authErr) return authErr;
  const { tenant_id } = await params;
  const body = await req.json();
  const resp = await fetch(`${WORKER_URL}/api/admin/tenants/${tenant_id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await resp.json(), { status: resp.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Params }) {
  const authErr = requireAdmin(_req);
  if (authErr) return authErr;
  const { tenant_id } = await params;
  const resp = await fetch(`${WORKER_URL}/api/admin/tenants/${tenant_id}`, {
    method: "DELETE",
    headers: { "X-Admin-Secret": ADMIN_SECRET },
  });
  return NextResponse.json(await resp.json(), { status: resp.status });
}
