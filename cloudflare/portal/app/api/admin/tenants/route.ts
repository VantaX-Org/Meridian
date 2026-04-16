import { requireAdmin } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const WORKER_URL =
  process.env.LICENCE_WORKER_URL || "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET || "";

export async function GET(request: NextRequest) {
  const authErr = requireAdmin(request);
  if (authErr) return authErr;

  const qs = request.nextUrl.searchParams.toString();
  const resp = await fetch(
    `${WORKER_URL}/api/admin/tenants${qs ? `?${qs}` : ""}`,
    { headers: { "X-Admin-Secret": ADMIN_SECRET }, cache: "no-store" }
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

export async function POST(request: NextRequest) {
  const authErr = requireAdmin(request);
  if (authErr) return authErr;

  const body = await request.json();
  const resp = await fetch(`${WORKER_URL}/api/admin/tenants`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Secret": ADMIN_SECRET },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
