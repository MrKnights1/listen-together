import { describe, expect, test } from "bun:test";
import {
  cpuTicks,
  rssByMinute,
  rssBytes,
  summarize,
  TARGETS,
  verdicts,
  type Sample,
} from "../measureResources.ts";

const MB = 1024 * 1024;

function samples(count: number, rssMb: (index: number) => number, cpuPercent: number): Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    at: index,
    rssBytes: rssMb(index) * MB,
    cpuPercent,
  }));
}

describe("cpuTicks", () => {
  test("adds user and system time", () => {
    const line = "4242 (bun) S 1 4242 4242 0 -1 4194560 9000 0 0 0 157 23 0 0 20 0 9 0 12345";

    expect(cpuTicks(line)).toBe(180);
  });

  /** A process may call itself anything, spaces and brackets included. */
  test("is not thrown by a name holding spaces and a closing bracket", () => {
    const line = "77 (a) b c) R 1 77 77 0 -1 4194560 10 0 0 0 5 6 0 0 20 0 1 0 99";

    expect(cpuTicks(line)).toBe(11);
  });
});

describe("rssBytes", () => {
  test("reads the resident set from the status file", () => {
    expect(rssBytes("Name:\tbun\nVmPeak:\t  900 kB\nVmRSS:\t   51200 kB\nThreads:\t9\n")).toBe(
      51200 * 1024,
    );
  });

  test("refuses a status with no resident set: the process is gone", () => {
    expect(() => rssBytes("Name:\tbun\nState:\tZ (zombie)\n")).toThrow("has exited");
  });
});

describe("summarize and verdicts", () => {
  test("passes a quiet, steady process", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, () => 45, 0.3),
    );

    expect(summary.idleRssMb).toBe(40);
    expect(summary.busyRssMb).toBe(45);
    expect(summary.growthMb).toBe(0);
    expect(verdicts(summary, TARGETS).every((verdict) => verdict.ok)).toBe(true);
  });

  test("fails a process that keeps growing, naming the target it missed", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, (index) => 45 + index / 20, 0.3),
    );

    const missed = verdicts(summary, TARGETS).filter((verdict) => !verdict.ok);

    expect(missed.map((verdict) => verdict.name)).toEqual(["growthMb"]);
    expect(summary.growthMb).toBeCloseTo(13.5, 1);
  });

  test("fails a busy CPU", () => {
    const summary = summarize(
      samples(60, () => 40, 0.1),
      samples(300, () => 45, 2.5),
    );

    expect(
      verdicts(summary, TARGETS).find((verdict) => verdict.name === "busyCpuPercent")?.ok,
    ).toBe(false);
  });

  test("will not judge from a run cut short", () => {
    expect(() =>
      summarize(
        samples(60, () => 40, 0.1),
        samples(10, () => 45, 0.3),
      ),
    ).toThrow("Too few samples");
  });
});

describe("rssByMinute", () => {
  test("averages each whole minute and drops a partial one", () => {
    const run = samples(150, (index) => (index < 60 ? 40 : 46), 0);

    expect(rssByMinute(run)).toEqual([40, 46]);
  });
});
