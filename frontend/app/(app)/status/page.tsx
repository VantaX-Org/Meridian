import type { Metadata } from "next";
import { Status } from "@/ui/screens/home/Status";

export const metadata: Metadata = {
  title: "Status",
  description: "Whether the platform is working: its components, the last 30 days, incidents and planned maintenance",
};

export default function Page() {
  return <Status />;
}
