import type { Metadata } from "next";
import { Home } from "@/design/next/feed/Home";

export const metadata: Metadata = { title: "Home" };

export default function PortfolioPage() {
  return <Home />;
}
