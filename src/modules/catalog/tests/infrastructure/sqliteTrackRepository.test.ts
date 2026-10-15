import { openDatabase } from "@/shared/infrastructure/database.ts";
import { migrate } from "@/shared/infrastructure/migrator.ts";
import { SqliteTrackRepository } from "@/modules/catalog/infrastructure/persistence/SqliteTrackRepository.ts";
import { runTrackRepositoryContract } from "@/modules/catalog/tests/support/repositoryContract.ts";

runTrackRepositoryContract("SQLite", () => {
  const db = openDatabase(":memory:");
  migrate(db);
  return new SqliteTrackRepository(db);
});
