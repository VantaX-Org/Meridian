import apiClient from "./client";
import type {
  RelationshipListResponse,
  RelationshipTypeRef,
} from "@/types/api";

export async function getRelationships(params?: {
  domain?: string;
  key?: string;
  include_inactive?: boolean;
}): Promise<RelationshipListResponse> {
  const { data } = await apiClient.get<RelationshipListResponse>(
    "/api/v1/relationships",
    { params }
  );
  return data;
}

export async function getRelationshipTypes(): Promise<RelationshipTypeRef[]> {
  const { data } = await apiClient.get<RelationshipTypeRef[]>(
    "/api/v1/relationship-types"
  );
  return data;
}
