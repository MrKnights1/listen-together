/** This listener's own volume and mute. Changes nothing for anyone else. */
export function VolumeControl({
  volume,
  muted,
  onVolume,
  onMuted,
}: {
  volume: number;
  muted: boolean;
  onVolume: (volume: number) => void;
  onMuted: (muted: boolean) => void;
}) {
  return (
    <div className="volume" role="group" aria-label="Your volume (only you hear this)">
      <button
        type="button"
        className="volume__mute"
        aria-pressed={muted}
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => onMuted(!muted)}
      >
        {muted ? "🔇" : "🔊"}
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={volume}
        aria-label="Volume"
        aria-valuetext={`${volume}%`}
        onChange={(event) => onVolume(Number(event.currentTarget.value))}
      />
    </div>
  );
}
