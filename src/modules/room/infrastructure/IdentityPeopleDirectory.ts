import { toUserView, type FindUsers } from "@/modules/identity/index.ts";
import type { Person } from "@/modules/room/domain/Person.ts";
import type { PeopleDirectory } from "@/modules/room/domain/ports/PeopleDirectory.ts";

/** The identity module's users, through its published surface, as the room's people. */
export class IdentityPeopleDirectory implements PeopleDirectory {
  constructor(private readonly findUsers: Pick<FindUsers, "execute">) {}

  async find(ids: string[]): Promise<Person[]> {
    return (await this.findUsers.execute(ids)).map(toUserView);
  }
}
