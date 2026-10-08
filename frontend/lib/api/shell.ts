import apiClient from "./client";

export interface ShellCounts {
  fix: number;
  inbox: number;
}

export async function getShellCounts(): Promise<ShellCounts> {
  const res = await apiClient.get<ShellCounts>("/api/v1/shell/counts");
  return res.data;
}
