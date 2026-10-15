import { describe, expect, test } from "bun:test";
import { SerialQueue } from "@/modules/room/application/SerialQueue.ts";

describe("SerialQueue", () => {
  test("runs tasks one at a time, in the order they arrived", async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    const task = (name: string, waitMs: number) => async () => {
      log.push(`${name} start`);
      await Bun.sleep(waitMs);
      log.push(`${name} end`);
      return name;
    };

    const results = await Promise.all([
      queue.run(task("a", 20)),
      queue.run(task("b", 1)),
      queue.run(task("c", 5)),
    ]);

    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
  });

  test("a failing task fails for its caller only, and the next one still runs", async () => {
    const queue = new SerialQueue();

    const failed = queue.run(async () => {
      throw new Error("boom");
    });
    const next = queue.run(async () => "fine");

    await expect(failed).rejects.toThrow("boom");
    expect(await next).toBe("fine");
  });
});
