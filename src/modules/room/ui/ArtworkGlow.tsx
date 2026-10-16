/**
 * The current song's artwork, blurred into a glow behind "now playing". A
 * layer of its own under everything else: it never reaches the player tile.
 */
export function ArtworkGlow({ artworkUrl }: { artworkUrl: string | null }) {
  return (
    <>
      {artworkUrl !== null && (
        <img className="hero__glow" src={artworkUrl} alt="" aria-hidden="true" />
      )}
      <div className="hero__scrim" aria-hidden="true" />
    </>
  );
}
