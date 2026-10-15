import type { Person } from "@/modules/room/domain/Person.ts";

/** Who the people in the room are — names and avatars, from the identity module. */
export interface PeopleDirectory {
  /** People that exist among `ids`; unknown ids are simply absent. */
  find(ids: string[]): Promise<Person[]>;
}
