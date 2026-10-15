import { InMemoryTrackRepository } from "./fakes.ts";
import { runTrackRepositoryContract } from "./repositoryContract.ts";

runTrackRepositoryContract("in-memory fake", () => new InMemoryTrackRepository());
