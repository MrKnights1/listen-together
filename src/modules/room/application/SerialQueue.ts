/**
 * Runs tasks one at a time, in the order they were handed in. The room is one
 * shared thing: two commands deciding against the same state at once would
 * each be right on their own and wrong together.
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    // The next task waits for this one to settle, whether it succeeded or not.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
