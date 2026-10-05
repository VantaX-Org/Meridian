import { redirect } from "next/navigation";

/** Migration is a tab under Data now. */
export default function MigrationRedirect() {
  redirect("/data?tab=migration");
}
