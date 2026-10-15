import type { User } from "@/modules/identity/domain/User.ts";

/** What the browser is allowed to know about a person. No Discord id, no username. */
export interface UserView {
  id: string;
  name: string;
  avatarUrl: string;
}

export function toUserView(user: User): UserView {
  return { id: user.id, name: user.displayName, avatarUrl: user.avatarUrl };
}
