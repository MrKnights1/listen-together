import type { Clock } from "@/shared/domain/Clock.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
