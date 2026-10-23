"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import { getUserGuidePdfUrl } from "@/lib/api/reports";
import { apiErrorMessage } from "@/lib/error";

/** The whole guide as one PDF, rendered by the API from the same chapters this page shows. */
export function DownloadGuide() {
  const [pending, setPending] = useState(false);
  const download = async () => {
    setPending(true);
    try {
      await downloadAuthenticated(getUserGuidePdfUrl(), "meridian_user_guide.pdf");
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <Button variant="secondary" onClick={() => void download()} pending={pending}>
      Download PDF
    </Button>
  );
}
