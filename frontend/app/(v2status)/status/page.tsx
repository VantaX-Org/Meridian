"use client";

import { useSyncExternalStore } from "react";
import { StatusScreen } from "@/design/v2/screens/Status";

const noop = () => () => undefined;
/** The marker cookie the auth context sets on sign-in (context/auth-context.tsx); the token itself is never read here. */
const signedIn = () => /(?:^|;\s*)mn_session=1(?:;|$)/.test(document.cookie);

/**
 * /status: readable signed out (middleware.ts lists it as public); it reads only GET /status/page. Someone signed in
 * gets the way back to Meridian instead of Sign in.
 */
export default function StatusPage() {
  const isSignedIn = useSyncExternalStore(noop, signedIn, () => false);
  return <StatusScreen signedIn={isSignedIn} />;
}
