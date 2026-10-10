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

export async function putOwner(body: {
  kind: OwnerKind;
  ref: string;
  owner_user_id: string | null;
  steward_user_id: string | null;
}): Promise<DataOwner> {
  const { data } = await apiClient.put<DataOwner>("/api/v1/owners", body);
  return data;
}
