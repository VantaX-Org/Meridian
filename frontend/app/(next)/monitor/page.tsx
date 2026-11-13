import type { Metadata } from "next";
import { Monitor } from "@/design/next/screens/Monitor";

export const metadata: Metadata = { title: "Monitor" };

export default function MonitorPage() {
  return <Monitor />;
}
