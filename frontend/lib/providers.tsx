"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryClient } from "./query-client";
import { LicenceProvider } from "@/context/licence-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return (
    <QueryClientProvider client={queryClient}>
      <LicenceProvider>{children}</LicenceProvider>
    </QueryClientProvider>
  );
}
