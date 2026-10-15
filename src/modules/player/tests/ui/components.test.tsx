import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlayerTile } from "@/modules/player/ui/PlayerTile.tsx";
import { VolumeControl } from "@/modules/player/ui/VolumeControl.tsx";

describe("PlayerTile", () => {
  test("is a 200×200 tile, YouTube's minimum player size", () => {
    const html = renderToStaticMarkup(<PlayerTile hostRef={createRef()} idle={false} />);

    expect(html).toContain("width:200px");
    expect(html).toContain("height:200px");
  });

  test("lays nothing over a playing player", () => {
    const html = renderToStaticMarkup(<PlayerTile hostRef={createRef()} idle={false} />);

    expect(html).not.toContain("player-tile__placeholder");
    expect(html).not.toContain("hidden");
  });

  test("shows a labelled placeholder, and hides the player, when nothing plays", () => {
    const html = renderToStaticMarkup(<PlayerTile hostRef={createRef()} idle={true} />);

    expect(html).toContain('aria-label="Nothing playing"');
    expect(html).toContain("hidden");
  });
});

describe("VolumeControl", () => {
  test("says it is this listener's own volume", () => {
    const html = renderToStaticMarkup(
      <VolumeControl
        volume={40}
        muted={false}
        onVolume={() => undefined}
        onMuted={() => undefined}
      />,
    );

    expect(html).toContain("only you hear this");
    expect(html).toContain('value="40"');
    expect(html).toContain('aria-pressed="false"');
  });

  test("offers to unmute when muted", () => {
    const html = renderToStaticMarkup(
      <VolumeControl
        volume={40}
        muted={true}
        onVolume={() => undefined}
        onMuted={() => undefined}
      />,
    );

    expect(html).toContain('aria-label="Unmute"');
    expect(html).toContain('aria-pressed="true"');
  });
});
