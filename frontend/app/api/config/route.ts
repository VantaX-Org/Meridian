import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    authMode: process.env.AUTH_MODE || "local",
  });
}
