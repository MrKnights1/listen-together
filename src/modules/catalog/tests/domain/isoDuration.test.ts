import { describe, expect, test } from "bun:test";
import { parseIsoDuration } from "@/modules/catalog/domain/youtube/isoDuration.ts";

describe("parseIsoDuration", () => {
  test.each([
    ["PT3M30S", 210_000],
    ["PT45S", 45_000],
    ["PT4M", 240_000],
    ["PT1H2M3S", 3_723_000],
    ["PT2H", 7_200_000],
    ["P1DT2H3M4S", 93_784_000],
    ["P1D", 86_400_000],
    ["P0D", 0],
  ])("%s is %d ms", (iso, ms) => {
    expect(parseIsoDuration(iso)).toBe(ms);
  });

  test.each(["", "P", "PT", "3:30", "PT3.5S", "P1W", "P1M", "PT-3S", "pt3m"])(
    "%p is not a duration YouTube sends",
    (iso) => {
      expect(parseIsoDuration(iso)).toBeNull();
    },
  );
});
