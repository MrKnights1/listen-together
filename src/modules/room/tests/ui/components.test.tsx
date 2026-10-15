import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ActivityFeed,
  AddTrackForm,
  ListenButton,
  NowPlaying,
  SeekBar,
  TransportControls,
  UpNextList,
  type QueueRow,
} from "@/modules/room/ui/components.tsx";
import { trackInfo } from "@/modules/room/tests/support/fakes.ts";

const people = {
  ada: { id: "ada", name: "Ada", avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png" },
  bob: { id: "bob", name: "Bob", avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png" },
};
const noop = () => undefined;

function row(entryId: string, ownerId: string, laneIndex: number, laneLength: number): QueueRow {
  return {
    entryId,
    ownerId,
    track: trackInfo(entryId),
    durationMs: 185_000,
    laneIndex,
    laneLength,
  };
}

describe("NowPlaying", () => {
  test("names the song, its artist and who queued it", () => {
    const html = renderToStaticMarkup(
      <NowPlaying track={trackInfo("one")} ownerId="ada" owner={people.ada} />,
    );

    expect(html).toContain("Song one");
    expect(html).toContain("Queued by");
    expect(html).toContain("Ada");
  });

  test("invites a paste when nothing plays", () => {
    expect(
      renderToStaticMarkup(<NowPlaying track={undefined} ownerId={null} owner={undefined} />),
    ).toContain("Paste a YouTube link");
  });
});

describe("SeekBar", () => {
  test("says it moves the song for everyone, and reads out the time", () => {
    const html = renderToStaticMarkup(
      <SeekBar positionMs={65_000} durationMs={185_000} disabled={false} onSeek={noop} />,
    );

    expect(html).toContain("moves it for everyone");
    expect(html).toContain('aria-valuetext="1:05 of 3:05"');
  });
});

describe("TransportControls", () => {
  test("offers Resume for a paused room and labels the group as shared", () => {
    const html = renderToStaticMarkup(
      <TransportControls
        status="paused"
        repeat="off"
        onToggle={noop}
        onSkip={noop}
        onShuffle={noop}
        onRepeat={noop}
      />,
    );

    expect(html).toContain("Resume");
    expect(html).toContain("for everyone");
    expect(html).toContain("Repeat is off");
  });

  test("disables pause and skip when nothing plays", () => {
    const html = renderToStaticMarkup(
      <TransportControls
        status="idle"
        repeat="all"
        onToggle={noop}
        onSkip={noop}
        onShuffle={noop}
        onRepeat={noop}
      />,
    );

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-pressed="true"');
  });
});

describe("ListenButton", () => {
  test("starts listening, and once listening offers to stop for this listener only", () => {
    expect(
      renderToStaticMarkup(<ListenButton listening={false} onStart={noop} onStop={noop} />),
    ).toContain("Start listening");
    expect(
      renderToStaticMarkup(<ListenButton listening={true} onStart={noop} onStop={noop} />),
    ).toContain("Stop listening");
  });
});

describe("UpNextList", () => {
  test("lists songs in play order, each in its owner's colour", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada", 0, 2), row("b1", "bob", 0, 1), row("a2", "ada", 1, 2)]}
        people={people}
        you="ada"
        onMove={noop}
        onRemove={noop}
        onShuffleMine={noop}
      />,
    );

    expect(html.indexOf("Song a1")).toBeLessThan(html.indexOf("Song b1"));
    expect(html.indexOf("Song b1")).toBeLessThan(html.indexOf("Song a2"));
    expect(html).toContain("--owner:");
  });

  test("names every row button for a screen reader, and disables moves that cannot happen", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada", 0, 1)]}
        people={people}
        you="ada"
        onMove={noop}
        onRemove={noop}
        onShuffleMine={noop}
      />,
    );

    expect(html).toContain('aria-label="Move Song a1 earlier in your list"');
    expect(html).toContain('aria-label="Remove Song a1 from the queue"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("invites a paste when nothing is queued", () => {
    expect(
      renderToStaticMarkup(
        <UpNextList
          rows={[]}
          people={people}
          you="ada"
          onMove={noop}
          onRemove={noop}
          onShuffleMine={noop}
        />,
      ),
    ).toContain("Nothing queued");
  });
});

describe("AddTrackForm", () => {
  test("labels the box, and announces its result politely", () => {
    const html = renderToStaticMarkup(<AddTrackForm onAdd={async () => "Added."} />);

    expect(html).toContain('for="add-url"');
    expect(html).toContain("YouTube video or playlist link");
    expect(html).toContain('role="status"');
  });
});

describe("ActivityFeed", () => {
  test("shows the newest line first, with who did it", () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        people={people}
        activity={[
          { id: 1, at: 0, actorId: "ada", kind: "added", detail: { count: 3 } },
          { id: 2, at: 1, actorId: "bob", kind: "skipped", detail: { title: "Song one" } },
        ]}
      />,
    );

    expect(html.indexOf("skipped Song one")).toBeLessThan(html.indexOf("added 3 songs"));
    expect(html).toContain("Bob");
  });
});
