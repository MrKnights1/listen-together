import { InMemorySessionRepository, InMemoryUserRepository } from "./fakes.ts";
import { runRepositoryContract } from "./repositoryContract.ts";

runRepositoryContract("in-memory fakes", () => ({
  users: new InMemoryUserRepository(),
  sessions: new InMemorySessionRepository(),
}));
