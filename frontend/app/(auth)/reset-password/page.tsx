"use client";

import { Suspense } from "react";
import { resetPassword } from "@/lib/api/auth";
import { SetPasswordForm } from "@/design/v2/auth/SetPassword";
import { t } from "@/lib/v2/i18n";

export default function ResetPasswordPage() {
  // useSearchParams must be inside a Suspense boundary under App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm title={t("Set password")} lead={t("This link works once. Signing in after this uses the new password.")} retryHref="/forgot-password"
        submitLabel={t("Save")} redirect="/sign-in?reset=1"
        missingToken={t("This link is missing its token. Open the link from your reset email exactly as sent.")}
        failure={t("Could not reset password. The link may have expired. Request a new one.")}
        submit={resetPassword} />
    </Suspense>
  );
}
