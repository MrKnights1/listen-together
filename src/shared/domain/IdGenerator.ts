/**
 * Identity as a dependency, so a use case can be tested against ids it chose
 * rather than ids it has to discover after the fact.
 */
export interface IdGenerator {
  newId(): string;
}
