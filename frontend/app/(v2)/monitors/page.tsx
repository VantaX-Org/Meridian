import { redirect } from "next/navigation";

/** The old address; learned monitors now live in the Work monitor segment. */
export default function LearnedMonitorsPage() {
  redirect("/work/monitor?tab=learned");
}
