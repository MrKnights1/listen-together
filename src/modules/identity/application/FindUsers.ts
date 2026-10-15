import type { User } from "@/modules/identity/domain/User.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

/**
 * The people behind a set of ids, in one read, for showing who added what.
 * Asking one at a time would be a query per queued song.
 */
export class FindUsers {
  constructor(private readonly users: UserRepository) {}

  async execute(ids: string[]): Promise<User[]> {
    return await this.users.findByIds([...new Set(ids)]);
  }
}
