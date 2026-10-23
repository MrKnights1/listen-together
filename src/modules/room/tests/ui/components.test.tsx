import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ActivityFeed } from "@/modules/room/ui/ActivityFeed.tsx";
import { AddTrackForm } from "@/modules/room/ui/AddTrackForm.tsx";
import { ArtworkGlow } from "@/modules/room/ui/ArtworkGlow.tsx";
import { AutoplayBlockedNotice } from "@/modules/room/ui/AutoplayBlockedNotice.tsx";
import { ConnectionBanner } from "@/modules/room/ui/ConnectionBanner.tsx";
import { ListenButton } from "@/modules/room/ui/ListenButton.tsx";
import { ListenerList } from "@/modules/room/ui/ListenerList.tsx";
import { NowPlaying } from "@/modules/room/ui/NowPlaying.tsx";
import { PlaylistChoice } from "@/modules/room/ui/PlaylistChoice.tsx";
import { RecentlyPlayed } from "@/modules/room/ui/RecentlyPlayed.tsx";
import { SeekBar } from "@/modules/room/ui/SeekBar.tsx";
import { SyncNotice } from "@/modules/room/ui/SyncNotice.tsx";
import { TransportControls } from "@/modules/room/ui/TransportControls.tsx";
import { UpNextList, type QueueRow } from "@/modules/room/ui/UpNextList.tsx";
import { UpNextRow } from "@/modules/room/ui/UpNextRow.tsx";
import { trackInfo } from "@/modules/room/tests/support/fakes.ts";

const people = {
  ada: { id: "ada", name: "Ada", avatarUrl: "https://cdn.discordapp.com/embed/avatars/0.png" },
  bob: { id: "bob", name: "Bob", avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png" },
};
const noop = () => undefined;

function row(entryId: string, ownerId: string): QueueRow {
  return { entryId, ownerId, track: trackInfo(entryId), durationMs: 185_000, addedAt: 0 };
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
      <SeekBar
        positionAt={() => 65_000}
        moving={false}
        durationMs={185_000}
        disabled={false}
        onSeek={noop}
      />,
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
        shuffle={false}
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

  test("names the icon keys by what they do, so the room can still be steered by name", () => {
    const html = renderToStaticMarkup(
      <TransportControls
        status="playing"
        repeat="off"
        shuffle={false}
        onToggle={noop}
        onSkip={noop}
        onShuffle={noop}
        onRepeat={noop}
      />,
    );

    expect(html).toContain('aria-label="Pause"');
    expect(html).toContain('aria-label="Skip"');
    expect(html).toContain('aria-label="Shuffle is off"');
    expect(html).toContain('title="Pause"');
    expect(html).not.toContain("Resume");
  });

  test("shows repeating one song as pressed, with its own label", () => {
    const html = renderToStaticMarkup(
      <TransportControls
        status="playing"
        repeat="one"
        shuffle={false}
        onToggle={noop}
        onSkip={noop}
        onShuffle={noop}
        onRepeat={noop}
      />,
    );

    expect(html).toContain('aria-label="Repeating this song"');
    expect(html).toContain('aria-pressed="true"');
  });

  test("shows shuffle as a switch, pressed and named for what it does while on", () => {
    const render = (shuffle: boolean) =>
      renderToStaticMarkup(
        <TransportControls
          status="playing"
          repeat="off"
          shuffle={shuffle}
          onToggle={noop}
          onSkip={noop}
          onShuffle={noop}
          onRepeat={noop}
        />,
      );

    expect(render(true)).toContain(
      'aria-label="Shuffle is on" title="Shuffle is on" aria-pressed="true"',
    );
    expect(render(false)).toContain(
      'aria-label="Shuffle is off" title="Shuffle is off" aria-pressed="false"',
    );
  });

  test("disables pause and skip when nothing plays", () => {
    const html = renderToStaticMarkup(
      <TransportControls
        status="idle"
        repeat="all"
        shuffle={false}
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

  test("keeps its name when it shows the headphones icon", () => {
    const html = renderToStaticMarkup(
      <ListenButton listening={false} onStart={noop} onStop={noop} />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/<\/svg>Start listening<\/button>/);
  });
});

describe("SyncNotice", () => {
  const notice = (status: Parameters<typeof SyncNotice>[0]["status"]) =>
    renderToStaticMarkup(<SyncNotice listening status={status} errorCode={null} onResync={noop} />);

  test("says YouTube's player didn't load, and offers to try again", () => {
    const html = notice("no_player");

    expect(html).toContain("sync--no_player");
    expect(html).toContain("YouTube&#x27;s player didn&#x27;t load");
    expect(html).toContain("Try again");
  });

  test("says why a refused song won't play, what helps, and no retry where none can work", () => {
    const html = renderToStaticMarkup(
      <SyncNotice listening status="error" errorCode={150} onResync={noop} />,
    );

    expect(html).toContain("YouTube won&#x27;t play it here");
    expect(html).toContain("sync__help");
    expect(html).toContain("Trying again won&#x27;t help");
    expect(html).not.toContain("Try again");
    expect(html).toContain('title="YouTube error 150"');
  });

  test("offers to try again when YouTube's player failed on this device", () => {
    const html = renderToStaticMarkup(
      <SyncNotice listening status="error" errorCode={5} onResync={noop} />,
    );

    expect(html).toContain("reload the page");
    expect(html).toContain("Try again");
  });

  test("offers to try again when out of sync, with no help line", () => {
    const html = notice("out_of_sync");

    expect(html).toContain("Try again");
    expect(html).not.toContain("sync__help");
  });

  test("offers nothing to try while the player is only catching up", () => {
    expect(notice("catching_up")).not.toContain("Try again");
  });

  test("shows nothing to someone not listening", () => {
    expect(
      renderToStaticMarkup(
        <SyncNotice listening={false} status="no_player" errorCode={null} onResync={noop} />,
      ),
    ).toBe("");
  });
});

describe("AutoplayBlockedNotice", () => {
  test("says nothing while the browser has not refused the sound", () => {
    expect(renderToStaticMarkup(<AutoplayBlockedNotice blocked={false} />)).toBe("");
  });

  test("tells the listener to press the very button that starts the sound again", () => {
    const html = renderToStaticMarkup(<AutoplayBlockedNotice blocked />);
    const button = renderToStaticMarkup(
      <ListenButton listening={false} onStart={noop} onStop={noop} />,
    );
    const buttonText = button.replace(/<[^>]+>/g, "");

    expect(buttonText).toBe("Start listening");
    expect(html).toContain("Your browser stopped the sound from starting");
    expect(html).toContain(`Press ${buttonText} again`);
    expect(html).toContain('role="status"');
  });
});

describe("RecentlyPlayed", () => {
  const addAgain = async () => "Added 1 song to your list.";
  const tracks = { "youtube:one": trackInfo("one"), "youtube:two": trackInfo("two") };
  const played = [
    { trackId: "youtube:two", ownerId: "bob", at: Date.UTC(2026, 9, 23, 18, 5) },
    { trackId: "youtube:one", ownerId: "ada", at: Date.UTC(2026, 9, 23, 18, 1) },
  ];

  test("is memoised: the room's other changes do not redraw it", () => {
    expect((RecentlyPlayed as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });

  test("says so before anything has played", () => {
    const html = renderToStaticMarkup(
      <RecentlyPlayed played={[]} tracks={{}} people={people} onAddAgain={addAgain} />,
    );

    expect(html).toContain("Recently played");
    expect(html).toContain("Nothing has played yet.");
  });

  test("lists the songs newest first, with who queued each and when it played", () => {
    const html = renderToStaticMarkup(
      <RecentlyPlayed played={played} tracks={tracks} people={people} onAddAgain={addAgain} />,
    );

    expect(html.indexOf("Song two")).toBeLessThan(html.indexOf("Song one"));
    expect(html.indexOf("Bob")).toBeLessThan(html.indexOf("Ada"));
    expect(html).toContain(`dateTime="${new Date(played[0]?.at ?? 0).toISOString()}"`);
  });

  test("offers to add each song again, naming it", () => {
    const html = renderToStaticMarkup(
      <RecentlyPlayed played={played} tracks={tracks} people={people} onAddAgain={addAgain} />,
    );

    expect(html).toContain('aria-label="Add Song two again"');
    expect(html).toContain('aria-label="Add Song one again"');
    expect(html.match(/title="Add again"/g)).toHaveLength(2);
  });

  test("offers nothing to add for a song whose details are gone", () => {
    const html = renderToStaticMarkup(
      <RecentlyPlayed
        played={[{ trackId: "youtube:lost", ownerId: "ada", at: 0 }]}
        tracks={{}}
        people={people}
        onAddAgain={addAgain}
      />,
    );

    expect(html).toContain("Unknown song");
    expect(html).not.toContain("again");
  });
});

describe("ArtworkGlow", () => {
  test("blurs the song's artwork behind now playing, hidden from assistive technology", () => {
    const html = renderToStaticMarkup(<ArtworkGlow artworkUrl="https://i.ytimg.com/vi/x/mq.jpg" />);

    expect(html).toContain('class="hero__glow"');
    expect(html).toContain('src="https://i.ytimg.com/vi/x/mq.jpg"');
    expect(html).toContain('aria-hidden="true"');
  });

  test("draws no image for a song without artwork", () => {
    const html = renderToStaticMarkup(<ArtworkGlow artworkUrl={null} />);

    expect(html).not.toContain("<img");
    expect(html).toContain("hero__scrim");
  });
});

describe("ListenerList", () => {
  const listeners = [
    { userId: "ada", listening: true, sync: "in_sync" as const, errorCode: null },
    { userId: "bob", listening: false, sync: "idle" as const, errorCode: null },
  ];

  test("marks which listener is you, and nobody else", () => {
    const html = renderToStaticMarkup(
      <ListenerList listeners={listeners} people={people} you="ada" />,
    );

    expect(html.match(/\(you\)/g)).toHaveLength(1);
    expect(html.indexOf("(you)")).toBeLessThan(html.indexOf("Bob"));
  });

  test("shows each listener's state as a coloured dot and a line", () => {
    const html = renderToStaticMarkup(
      <ListenerList listeners={listeners} people={people} you="ada" />,
    );

    expect(html).toContain("face__dot--in_sync");
    expect(html).toContain("listener__state--in_sync");
    expect(html).toContain("In sync");
    expect(html).toContain("face__dot--away");
    expect(html).toContain("Here, not listening");
  });

  test("says in plain words why someone's player refused the song", () => {
    const html = renderToStaticMarkup(
      <ListenerList
        listeners={[{ userId: "bob", listening: true, sync: "error", errorCode: 100 }]}
        people={people}
        you="ada"
      />,
    );

    expect(html).toContain(
      "Can&#x27;t play this song: it was removed from YouTube or made private",
    );
    expect(html).not.toContain("100");
  });

  test("says when someone's browser could not load YouTube's player", () => {
    const html = renderToStaticMarkup(
      <ListenerList
        listeners={[{ userId: "bob", listening: true, sync: "no_player", errorCode: null }]}
        people={people}
        you="ada"
      />,
    );

    expect(html).toContain("listener__state--no_player");
    expect(html).toContain("YouTube&#x27;s player didn&#x27;t load");
  });
});

describe("UpNextList", () => {
  /** Re-rendering a full room's 5000 rows on every room change blocks the page for seconds. */
  test("is memoised, and so is each of its rows", () => {
    expect((UpNextList as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
    expect((UpNextRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for("react.memo"));
  });

  test("numbers the rows in play order and names each song's artist", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada"), row("b1", "bob")]}
        shuffle={false}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );

    expect(html).toContain('<ol class="queue queue--numbered">');
    expect(html.indexOf("Song a1")).toBeLessThan(html.indexOf("Song b1"));
    expect(html).toContain('<span class="row__artist">Artist</span>');
  });

  /** The numbers are the list's own counter: a row keeps no place of its own to redraw. */
  test("numbers its rows from the stylesheet's counter", async () => {
    const css = await Bun.file("src/app/room/room.css").text();

    expect(css).toMatch(/\.queue--numbered \{\s*counter-reset: row;/);
    expect(css).toMatch(/\.queue--numbered \.row \{\s*counter-increment: row;/);
    expect(css).toMatch(/\.queue--numbered \.row__n::before \{\s*content: counter\(row\);/);
  });

  test("lists songs in play order, each in its owner's colour", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada"), row("b1", "bob"), row("a2", "ada")]}
        shuffle={false}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );

    expect(html.indexOf("Song a1")).toBeLessThan(html.indexOf("Song b1"));
    expect(html.indexOf("Song b1")).toBeLessThan(html.indexOf("Song a2"));
    expect(html).toContain("--owner:");
  });

  test("says songs play in the order they were added", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada")]}
        shuffle={false}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );

    expect(html).toContain("Songs play in the order they were added.");
    expect(html).not.toContain("rotate");
  });

  test("lets any song move up or down the whole queue, except past either end", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada"), row("b1", "bob"), row("a2", "ada")]}
        shuffle={false}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );
    const disabled = (label: string) =>
      new RegExp(`disabled=""[^>]*aria-label="${label}"`).test(html);

    expect(disabled("Move Song a1 earlier in the queue")).toBe(true);
    expect(disabled("Move Song a1 later in the queue")).toBe(false);
    expect(disabled("Move Song b1 earlier in the queue")).toBe(false);
    expect(disabled("Move Song b1 later in the queue")).toBe(false);
    expect(disabled("Move Song a2 later in the queue")).toBe(true);
  });

  test("names every row button for a screen reader, and disables moves that cannot happen", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada")]}
        shuffle={false}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );

    expect(html).toContain('aria-label="Move Song a1 earlier in the queue"');
    expect(html).toContain('aria-label="Remove Song a1 from the queue"');
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("with shuffle on, is a pool to draw from: no numbers, and it says so", () => {
    const html = renderToStaticMarkup(
      <UpNextList
        rows={[row("a1", "ada"), row("b1", "bob")]}
        shuffle={true}
        starred={[]}
        people={people}
        onMove={noop}
        onStar={noop}
        onRemove={noop}
        onShuffleQueue={noop}
        onClear={noop}
      />,
    );

    expect(html).toContain("Shuffle is on: each next song is picked at random.");
    expect(html).not.toContain("Songs play in the order they were added.");
    expect(html).toContain('<span class="row__n" aria-hidden="true"></span>');
    expect(html).not.toContain('<span class="row__n" aria-hidden="true">1</span>');
    expect(html).toContain('<ol class="queue">');
  });

  describe("Stars", () => {
    const render = (shuffle: boolean, starred: string[]) =>
      renderToStaticMarkup(
        <UpNextList
          rows={[row("a1", "ada"), row("b1", "bob"), row("a2", "ada")]}
          shuffle={shuffle}
          starred={starred}
          people={people}
          onMove={noop}
          onStar={noop}
          onRemove={noop}
          onShuffleQueue={noop}
          onClear={noop}
        />,
      );
    const starButton = (html: string, title: string) =>
      new RegExp(`<button[^>]*aria-label="Play ${title} next"[^>]*>`).exec(html)?.[0];

    test("with shuffle on, every row offers a star instead of moving up or down", () => {
      const html = render(true, []);

      expect(html).not.toContain("Move Song");
      for (const title of ["Song a1", "Song b1", "Song a2"]) {
        expect(starButton(html, title)).toContain('aria-pressed="false"');
      }
      expect(html).toContain('aria-label="Remove Song a1 from the queue"');
    });

    test("shows each starred song pressed, with its place in the line, without hovering", () => {
      const html = render(true, ["a2", "a1"]);

      expect(starButton(html, "Song a2")).toContain('aria-pressed="true"');
      expect(starButton(html, "Song a1")).toContain('aria-pressed="true"');
      expect(starButton(html, "Song b1")).toContain('aria-pressed="false"');
      const places = [...html.matchAll(/<span class="row__star">.*?(\d+)<\/span>/g)].map(
        (match) => match[1],
      );
      // Rows stay in queue order: a1 is starred second, a2 first.
      expect(places).toEqual(["2", "1"]);
    });

    test("says starred songs play first while any are starred", () => {
      expect(render(true, [])).toContain("Star a song to play it next.");
      expect(render(true, ["b1"])).toContain(
        "Shuffle is on: starred songs play first, in the order they were starred, then each next song is picked at random.",
      );
    });

    test("with shuffle off, the stars are hidden and the rows are numbered and movable", () => {
      const html = render(false, ["b1"]);

      expect(html).not.toContain("row__star");
      expect(html).not.toContain('aria-label="Play ');
      expect(html).toContain('aria-label="Move Song b1 earlier in the queue"');
      expect(html).toContain('<ol class="queue queue--numbered">');
    });
  });

  describe("Song count", () => {
    const render = (rows: QueueRow[]) =>
      renderToStaticMarkup(
        <UpNextList
          rows={rows}
          shuffle={false}
          starred={[]}
          people={people}
          onMove={noop}
          onStar={noop}
          onRemove={noop}
          onShuffleQueue={noop}
          onClear={noop}
        />,
      );

    test("says how many songs wait, beside the heading, which still reads Up next", () => {
      const html = render([row("a1", "ada"), row("b1", "bob"), row("a2", "ada")]);

      expect(html).toContain(
        '<h2 id="upnext-heading">Up next</h2><span class="upnext__count">3 songs</span>',
      );
    });

    test("says 1 song for one, and 0 songs when nothing is queued", () => {
      expect(render([row("a1", "ada")])).toContain('<span class="upnext__count">1 song</span>');
      expect(render([])).toContain('<span class="upnext__count">0 songs</span>');
    });
  });

  test("invites a paste when nothing is queued", () => {
    expect(
      renderToStaticMarkup(
        <UpNextList
          rows={[]}
          shuffle={false}
          starred={[]}
          people={people}
          onMove={noop}
          onStar={noop}
          onRemove={noop}
          onShuffleQueue={noop}
          onClear={noop}
        />,
      ),
    ).toContain("Nothing queued");
  });

  describe("Shuffle queue", () => {
    const shuffleButton = (rows: QueueRow[]) => {
      const html = renderToStaticMarkup(
        <UpNextList
          rows={rows}
          shuffle={false}
          starred={[]}
          people={people}
          onMove={noop}
          onStar={noop}
          onRemove={noop}
          onShuffleQueue={noop}
          onClear={noop}
        />,
      );
      const button = /<button[^>]*>(?:(?!<\/button>).)*Shuffle queue<\/button>/.exec(html)?.[0];
      if (button === undefined) throw new Error("There is no Shuffle queue button.");
      return button;
    };

    test("shuffles everyone's songs, so two songs from two people are enough", () => {
      expect(shuffleButton([row("a1", "ada"), row("b1", "bob")])).not.toContain("disabled");
    });

    test("cannot be pressed while fewer than two songs are queued", () => {
      expect(shuffleButton([row("a1", "ada")])).toContain('disabled=""');
      expect(shuffleButton([])).toContain('disabled=""');
    });
  });

  describe("Clear queue", () => {
    const clearButton = (rows: QueueRow[]) => {
      const html = renderToStaticMarkup(
        <UpNextList
          rows={rows}
          shuffle={false}
          starred={[]}
          people={people}
          onMove={noop}
          onStar={noop}
          onRemove={noop}
          onShuffleQueue={noop}
          onClear={noop}
        />,
      );
      const button = /<button[^>]*>(?:(?!<\/button>).)*Clear queue<\/button>/.exec(html)?.[0];
      if (button === undefined) throw new Error("There is no Clear queue button.");
      return { html, button };
    };

    test("is offered beside the queue, in the colour that warns", () => {
      const { button } = clearButton([row("a1", "ada"), row("b1", "bob")]);

      expect(button).toContain("button--danger");
      expect(button).not.toContain("disabled");
    });

    test("cannot be pressed while nothing is queued", () => {
      expect(clearButton([]).button).toContain('disabled=""');
    });

    test("asks nothing until it is pressed", () => {
      expect(clearButton([row("a1", "ada")]).html).not.toContain("<dialog");
    });
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

describe("PlaylistChoice", () => {
  test("offers the song alone or the playlist from it, as buttons that do not submit", () => {
    const html = renderToStaticMarkup(<PlaylistChoice onChoose={noop} />);

    expect(html).toContain("This song is part of a playlist.");
    expect(html).toContain(">Just this song</button>");
    expect(html).toContain(">Playlist from this song on</button>");
    expect(html.match(/type="button"/g)).toHaveLength(2);
  });
});

describe("ConnectionBanner", () => {
  test("stays hidden while connected", () => {
    expect(renderToStaticMarkup(<ConnectionBanner state="open" />)).toContain('hidden=""');
  });

  test("says the room is reconnecting, beside a spinner", () => {
    const html = renderToStaticMarkup(<ConnectionBanner state="reconnecting" />);

    expect(html).not.toContain('hidden=""');
    expect(html).toContain("Lost the connection. Reconnecting…");
    expect(html).toContain("banner__spinner");
  });
});

describe("ActivityFeed", () => {
  test("greys out what the room did by itself", () => {
    const html = renderToStaticMarkup(
      <ActivityFeed
        people={people}
        activity={[{ id: 1, at: 0, actorId: null, kind: "auto_paused", detail: {} }]}
      />,
    );

    expect(html).toContain('class="feed__system"');
    expect(html).toContain("The room paused itself");
  });

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
