import { redirect } from "next/navigation";

// Sign-up is handled by Cloudflare Access — redirect to admin portal.
export default function SignUpPage() {
  redirect("/admin");
}
