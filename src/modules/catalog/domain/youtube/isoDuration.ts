/**
 * YouTube's ISO 8601 durations: `PT#M#S`, `PT#H#M#S`, and `P#DT#H#M#S` for a
 * day or longer. Live and upcoming broadcasts report `P0D`. Anything else —
 * weeks, months, fractions — is not a shape YouTube sends and comes back null.
 */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export function parseIsoDuration(value: string): number | null {
  const match = ISO_DURATION.exec(value);
  if (match === null || value === "P" || value.endsWith("T")) return null;

  const [, days, hours, minutes, seconds] = match;
  const number = (part: string | undefined) => (part === undefined ? 0 : Number(part));

  return (
    ((number(days) * 24 + number(hours)) * 60 + number(minutes)) * 60_000 + number(seconds) * 1000
  );
}
