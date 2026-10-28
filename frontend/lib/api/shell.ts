import apiClient from "./client";

export interface ShellCounts {
  /** Records to fix in the latest run's work list (the Fix pill badge), or null when no work list is built. */
  fix: number | null;
  inbox: number;
}

export async function getShellCounts(): Promise<ShellCounts> {
  const res = await apiClient.get<ShellCounts>("/api/v1/shell/counts");
  return res.data;
}
