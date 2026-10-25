import { redirect } from "next/navigation";

/** `/login` → `/sign-in`, on the server, so no blank client page renders first. */
export default function LoginRedirect(): never {
  redirect("/sign-in");
}
