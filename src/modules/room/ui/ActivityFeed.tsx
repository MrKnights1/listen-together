import type { Person } from "@/modules/room/contract/messages.ts";
import type { ActivityEntry } from "@/modules/room/domain/activity.ts";
import { activityLine } from "./wording.ts";

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ActivityFeed({
  activity,
  people,
}: {
  activity: ActivityEntry[];
  people: Record<string, Person>;
}) {
  const latestFirst = [...activity].reverse();
  return (
    <section className="activity" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Activity</h2>
      {latestFirst.length === 0 ? (
        <p className="empty">Nothing has happened yet.</p>
      ) : (
        <ol className="feed">
          {latestFirst.map((entry) => (
            <li key={entry.id} className="feed__row">
              <time className="feed__time" dateTime={new Date(entry.at).toISOString()}>
                {clockTime(entry.at)}
              </time>
              <span className={entry.actorId === null ? "feed__system" : undefined}>
                {entry.actorId !== null && (
                  <strong className="feed__who">{people[entry.actorId]?.name ?? "Someone"} </strong>
                )}
                {activityLine(entry)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
