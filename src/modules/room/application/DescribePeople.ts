import type { Person } from "@/modules/room/domain/Person.ts";
import type { PeopleDirectory } from "@/modules/room/domain/ports/PeopleDirectory.ts";

/** Names and avatars for a set of people, in one read. */
export class DescribePeople {
  constructor(private readonly people: PeopleDirectory) {}

  async execute(ids: string[]): Promise<Person[]> {
    const unique = [...new Set(ids)];
    return unique.length === 0 ? [] : await this.people.find(unique);
  }
}
