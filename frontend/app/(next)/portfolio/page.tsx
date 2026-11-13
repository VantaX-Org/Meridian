import type { Metadata } from "next";
import { Portfolio } from "@/design/next/screens/Portfolio";

export const metadata: Metadata = { title: "Portfolio" };

export default function PortfolioPage() {
  return <Portfolio />;
}
