import { Skeleton } from "@/design/next/kit";

/** A screen on its way (a route's code or data): its placeholder inside the shell that stays put. */
export default function Loading() {
  return <Skeleton lines={6} />;
}
