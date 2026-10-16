import type { Person } from "@/modules/room/contract/messages.ts";
import { Avatar } from "./Avatar.tsx";
import { ownerColor } from "./ownerColor.ts";

export function OwnerChip({ ownerId, person }: { ownerId: string; person: Person | undefined }) {
  return (
    <span className="owner" style={{ "--owner": ownerColor(ownerId) } as React.CSSProperties}>
      <Avatar person={person} size={22} />
      <span className="owner__name">{person?.name ?? "Someone"}</span>
    </span>
  );
}
