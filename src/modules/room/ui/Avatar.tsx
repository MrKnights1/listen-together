import type { Person } from "@/modules/room/contract/messages.ts";

export function Avatar({ person, size }: { person: Person | undefined; size: number }) {
  // Decorative: the name is always written beside it.
  return person === undefined ? (
    <span
      className="avatar avatar--unknown"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  ) : (
    <img
      className="avatar"
      src={person.avatarUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
    />
  );
}
