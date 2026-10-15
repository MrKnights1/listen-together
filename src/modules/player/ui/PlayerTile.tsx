import type { RefObject } from "react";
import { BrandMark } from "@/shared/ui/BrandMark.tsx";
import { PLAYER_SIZE_PX } from "./youtube/YouTubeIframeAdapter.ts";

/**
 * Where the provider's player lives: a 200×200 tile, the size of album art and
 * YouTube's minimum. The player owns everything inside `hostRef` — React never
 * renders into it, because the player swaps its contents for an iframe. When
 * nothing plays the tile shows a placeholder instead; nothing is ever laid
 * over the player itself.
 */
export function PlayerTile({
  hostRef,
  idle,
}: {
  hostRef: RefObject<HTMLDivElement | null>;
  idle: boolean;
}) {
  return (
    <div className="player-tile" style={{ width: PLAYER_SIZE_PX, height: PLAYER_SIZE_PX }}>
      <div ref={hostRef} className="player-tile__host" hidden={idle} />
      {idle && (
        <div className="player-tile__placeholder" role="img" aria-label="Nothing playing">
          <BrandMark className="player-tile__mark" />
        </div>
      )}
    </div>
  );
}
