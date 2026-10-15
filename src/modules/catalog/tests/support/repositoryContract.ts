import { beforeEach, describe, expect, test } from "bun:test";
import type { TrackRepository } from "@/modules/catalog/domain/ports/TrackRepository.ts";
import { track } from "./fakes.ts";

const NOW = new Date("2026-10-15T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

/** One suite, run against SQLite and the in-memory fake, so the fake cannot drift. */
export function runTrackRepositoryContract(name: string, create: () => TrackRepository): void {
  describe(`${name} — TrackRepository`, () => {
    let tracks: TrackRepository;
    beforeEach(() => {
      tracks = create();
    });

    test("finds nothing it was never given", async () => {
      expect(await tracks.findByIds(["youtube:nothinghere"])).toEqual([]);
      expect(await tracks.findByIds([])).toEqual([]);
    });

    test("round-trips a track without changing any field", async () => {
      const one = track("dQw4w9WgXcQ", { artworkUrl: "https://i.ytimg.com/x.jpg" });

      await tracks.saveAll([one]);

      expect((await tracks.findByIds([one.id]))[0]?.toSnapshot()).toEqual(one.toSnapshot());
    });

    test("keeps an unplayable reason and a missing artwork as they were", async () => {
      const one = track("dQw4w9WgXcQ", { unplayableReason: "region_blocked", artworkUrl: null });

      await tracks.saveAll([one]);

      const stored = (await tracks.findByIds([one.id]))[0];
      expect(stored?.unplayableReason).toBe("region_blocked");
      expect(stored?.artworkUrl).toBeNull();
    });

    test("overwrites a cached track with fresher metadata instead of adding another", async () => {
      await tracks.saveAll([track("dQw4w9WgXcQ")]);
      const later = new Date(NOW.getTime() + DAY);

      await tracks.saveAll([track("dQw4w9WgXcQ", { title: "Renamed", fetchedAt: later })]);

      const stored = await tracks.findByIds(["youtube:dQw4w9WgXcQ"]);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.title).toBe("Renamed");
      expect(stored[0]?.fetchedAt).toEqual(later);
    });

    test("finds tracks fetched at or before a cutoff", async () => {
      await tracks.saveAll([
        track("old00000001", { fetchedAt: new Date(NOW.getTime() - 40 * DAY) }),
        track("edge0000001", { fetchedAt: new Date(NOW.getTime() - 25 * DAY) }),
        track("new00000001", { fetchedAt: NOW }),
      ]);

      const stale = await tracks.findStale(new Date(NOW.getTime() - 25 * DAY));

      expect(stale.map((one) => one.providerTrackId).sort()).toEqual([
        "edge0000001",
        "old00000001",
      ]);
    });

    test("deletes exactly the tracks named", async () => {
      await tracks.saveAll([track("keep0000001"), track("drop0000001")]);

      await tracks.deleteByIds(["youtube:drop0000001"]);
      await tracks.deleteByIds([]);

      expect(
        (await tracks.findByIds(["youtube:keep0000001", "youtube:drop0000001"])).map(
          (one) => one.providerTrackId,
        ),
      ).toEqual(["keep0000001"]);
    });
  });
}
