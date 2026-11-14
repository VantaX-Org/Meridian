import { RunsCanvas } from "@/design/v2/screens/Runs";
import { Runs } from "@/design/next/runs/Runs";
import { NextSwap } from "@/design/next/runs/NextSwap";

export default function RunsPage() {
  return <NextSwap next={Runs} old={RunsCanvas} />;
}
