import { redirect } from "next/navigation";

// Self-registration is not supported in local auth mode.
// Accounts are created by an admin via the CLI or user management page.
export default function SignUpPage() {
  redirect("/sign-in");
}
