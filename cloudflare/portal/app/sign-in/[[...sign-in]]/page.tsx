import { redirect } from "next/navigation";

// Sign-in is handled by Cloudflare Access — redirect to admin portal.
export default function SignInPage() {
  redirect("/admin");
}
