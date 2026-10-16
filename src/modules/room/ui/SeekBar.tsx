import { useEffect, useEffectEvent, useRef, useState } from "react";
import { formatDuration } from "./wording.ts";

/**
 * The room's position, which anyone may move. Seeks on release, not on every
 * pixel dragged: the room hears one jump, not a hundred.
 */
export function SeekBar({
  positionMs,
  durationMs,
  disabled,
  onSeek,
}: {
  positionMs: number;
  durationMs: number;
  disabled: boolean;
  onSeek: (positionMs: number) => void;
}) {
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = useEffectEvent((seconds: number) => {
    onSeek(seconds * 1000);
    setScrubbing(null);
  });

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return;
    const onChange = () => commit(Number(input.value));
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, []);

  const shown = scrubbing ?? positionMs;
  return (
    <div className="seek">
      <span className="seek__time">{formatDuration(shown)}</span>
      <input
        ref={inputRef}
        className="range"
        type="range"
        min={0}
        max={Math.max(1, Math.floor(durationMs / 1000))}
        step={1}
        value={Math.floor(shown / 1000)}
        disabled={disabled}
        aria-label="Position in the song (moves it for everyone)"
        aria-valuetext={`${formatDuration(shown)} of ${formatDuration(durationMs)}`}
        onChange={(event) => setScrubbing(Number(event.currentTarget.value) * 1000)}
        style={
          {
            "--progress": `${durationMs === 0 ? 0 : (100 * shown) / durationMs}%`,
          } as React.CSSProperties
        }
      />
      <span className="seek__time">{formatDuration(durationMs)}</span>
    </div>
  );
}
