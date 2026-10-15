import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { SqliteSessionRepository } from "@/modules/identity/infrastructure/persistence/SqliteSessionRepository.ts";
import { SqliteUserRepository } from "@/modules/identity/infrastructure/persistence/SqliteUserRepository.ts";
import { runRepositoryContract } from "@/modules/identity/tests/support/repositoryContract.ts";

runRepositoryContract("SQLite", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  return { users: new SqliteUserRepository(db), sessions: new SqliteSessionRepository(db) };
});
