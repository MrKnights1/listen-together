import type { ListenerView, Person } from "@/modules/room/contract/messages.ts";
import { Avatar } from "./Avatar.tsx";
import { ownerColor } from "./ownerColor.ts";
import { presenceLine } from "./wording.ts";

export function ListenerList({
  listeners,
  people,
  you,
}: {
  listeners: ListenerView[];
  people: Record<string, Person>;
  you: string | null;
}) {
  return (
    <section className="people" aria-labelledby="listeners-heading">
      <h2 id="listeners-heading">Listening now</h2>
      <ul className="listeners">
        {listeners.map((listener) => {
          const person = people[listener.userId];
          const state = listener.listening ? listener.sync : "away";
          return (
            <li
              key={listener.userId}
              className="listener"
              style={{ "--owner": ownerColor(listener.userId) } as React.CSSProperties}
            >
              <span className="face">
                <Avatar person={person} size={36} />
                <span className={`face__dot face__dot--${state}`} aria-hidden="true" />
              </span>
              <span className="listener__text">
                <span className="listener__name">
                  {person?.name ?? "Someone"}
                  {listener.userId === you && <span className="listener__you"> (you)</span>}
                </span>
                <span className={`listener__state listener__state--${state}`}>
                  {presenceLine(listener.listening, listener.sync, listener.errorCode)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
