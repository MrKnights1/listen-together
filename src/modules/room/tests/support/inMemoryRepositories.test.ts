import { InMemoryActivityRepository, InMemoryRoomRepository } from "./fakes.ts";
import { runRoomRepositoryContracts } from "./repositoryContracts.ts";

runRoomRepositoryContracts("in-memory fakes", () => ({
  rooms: new InMemoryRoomRepository(),
  activity: new InMemoryActivityRepository(),
}));
