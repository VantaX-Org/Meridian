"use client";

import type { ComponentType } from "react";
import { ApiKeysSection } from "./people-keys";
import { DelegationsSection, ShareLinksSection, ViewAsSection } from "./people-capabilities";
import { RolesSection } from "./people-roles";
import { SsoSection } from "./people-signin";
import { UsersSection } from "./people-users";

function SsoPart() {
  return <SsoSection part="sso" />;
}

function SigninPart() {
  return <SsoSection part="signin" />;
}

/** Admin people group: slug to section. */
export const PEOPLE_SECTIONS: Record<string, ComponentType> = {
  users: UsersSection,
  roles: RolesSection,
  sso: SsoPart,
  signin: SigninPart,
  apikeys: ApiKeysSection,
  viewas: ViewAsSection,
  sharelinks: ShareLinksSection,
  delegations: DelegationsSection,
};

export { ShareLinksSection };
