/**
 * Each person's colour, so the rotation can be seen at a glance in "Up next":
 * Ada, Bob, Ada, Bob. Six hues, measured at 6.8–8.9:1 against the panels
 * (AA asks 4.5:1); with more than six people two may share one, and the name
 * beside it still tells them apart.
 */
export const OWNER_COLORS = [
  "#7FB3FF",
  "#F28FB1",
  "#8BD3A0",
  "#C3A6FF",
  "#F6A96C",
  "#6FD6D9",
] as const;

/** Stable for a person across reloads and devices: derived from their id, not their order of arrival. */
export function ownerColor(userId: string): string {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return OWNER_COLORS[hash % OWNER_COLORS.length] ?? OWNER_COLORS[0];
}
