import apiClient from "./client";

export interface ShellCounts {
  fix: number;
  /** What `fix` counts: records to fix in the latest run's work list, or (no work list) cleaning proposals to review. */
  fix_source?: "work" | "cleaning";
  inbox: number;
}

export async function getShellCounts(): Promise<ShellCounts> {
  const res = await apiClient.get<ShellCounts>("/api/v1/shell/counts");
  return res.data;
}
