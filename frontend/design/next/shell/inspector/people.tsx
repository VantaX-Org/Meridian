"use client";

/** The people group of native inspector bodies: user, role, API key, audit entry, alert channel. */
import type { ComponentType } from "react";
import type { BodyProps } from "./frame";
import { UserInspector } from "./people-user";
import { RoleInspector } from "./people-role";
import { ApiKeyInspector } from "./people-key";
import { AuditInspector, ChannelInspector } from "./people-records";

export const PEOPLE_BODIES: Record<string, ComponentType<BodyProps>> = {
  user: UserInspector,
  role: RoleInspector,
  apikey: ApiKeyInspector,
  audit: AuditInspector,
  channel: ChannelInspector,
};
