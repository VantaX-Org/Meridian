"use client";

import { StatusScreen } from "@/design/v2/screens/Status";

/** /v2/status: readable signed out (middleware.ts lists it as public); it reads only GET /status/page. */
export default function PublicStatusPage() {
  return <StatusScreen />;
}
