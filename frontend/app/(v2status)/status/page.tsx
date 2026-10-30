"use client";

import { StatusScreen } from "@/design/v2/screens/Status";

/** /status: the same page for someone signed in (the middleware sends anyone else to sign in), with the way back. */
export default function SignedInStatusPage() {
  return <StatusScreen signedIn />;
}
