/**
 * POST /api/admin/tenants/:tenant_id/offline-token
 *
 * Generates a signed RS256 JWT offline licence token for air-gapped deployments.
 * The token embeds the full licence manifest so the customer backend can verify
 * it locally without a network call to licence.meridian.vantax.co.za.
 *
 * Body:
 *   { expiryDays?: number }   defaults to 365
 *
 * Returns:
 *   { token: string, expiresAt: string, envSnippet: string }
 */

import { requireAdmin } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const WORKER_URL =
  process.env.LICENCE_WORKER_URL ?? "https://licence.meridian.vantax.co.za";
const ADMIN_SECRET = process.env.LICENCE_ADMIN_SECRET ?? "";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenant_id: string }> }
) {
  const authErr = requireAdmin(req);
  if (authErr) return authErr;

  const { tenant_id } = await params;
  const body = await req.json().catch(() => ({}));
  const expiryDays: number = Number(body.expiryDays) || 365;

  const workerResp = await fetch(
    `${WORKER_URL}/api/admin/tenants/${tenant_id}/offline-token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Secret": ADMIN_SECRET,
      },
      body: JSON.stringify({ expiryDays }),
    }
  );

  const data = await workerResp.json();

  if (!workerResp.ok) {
    return NextResponse.json(data, { status: workerResp.status });
  }

  return NextResponse.json(data);
}
