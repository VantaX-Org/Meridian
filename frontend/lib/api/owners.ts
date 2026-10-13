import apiClient from "./client";

export type OwnerKind = "object" | "rule" | "system";

export interface DataOwner {
  kind: OwnerKind;
  ref: string;
  owner_user_id: string | null;
  owner_name: string | null;
  steward_user_id: string | null;
  steward_name: string | null;
  updated_at: string | null;
}

export async function getOwners(kind: OwnerKind): Promise<DataOwner[]> {
  const { data } = await apiClient.get<{ owners: DataOwner[] }>("/api/v1/owners", { params: { kind } });
  return data.owners;
}

/** POST /api/v1/owners/digests/send: writes the weekly digest notification now, for one owner (by name) or for every owner. */
export async function sendOwnerDigests(body: { owner?: string }): Promise<{ sent: number; owner: string | null }> {
  const { data } = await apiClient.post<{ sent: number; owner: string | null }>("/api/v1/owners/digests/send", body);
  return data;
}

export async function putOwner(body: {
  kind: OwnerKind;
  ref: string;
  owner_user_id: string | null;
  steward_user_id: string | null;
}): Promise<DataOwner> {
  const { data } = await apiClient.put<DataOwner>("/api/v1/owners", body);
  return data;
}
