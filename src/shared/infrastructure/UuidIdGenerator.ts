import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";

export class UuidIdGenerator implements IdGenerator {
  newId(): string {
    return crypto.randomUUID();
  }
}
