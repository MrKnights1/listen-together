import { useEffect, useEffectEvent, useRef, useState } from "react";
import { formatDuration } from "./wording.ts";

/**
 * This device's monotonic time, refreshed every `ms` while `running`. A stale
 * reading right after a resume is harmless: the room's position never runs
 * back before its anchor.
 */
function useTicker(ms: number, running: boolean): number {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (!running) return;
    const handle = setInterval(() => setNow(performance.now()), ms);
    return () => clearInterval(handle);
  }, [ms, running]);
  return now;
}

/**
 * The room's position, which anyone may move. Seeks on release, not on every
 * pixel dragged: the room hears one jump, not a hundred. Its clock ticks here,
 * and only while the song moves, so the rest of the page is not redrawn with it.
 */
export function SeekBar({
  positionAt,
  moving,
  durationMs,
  disabled,
  onSeek,
}: {
  /** The room's position at this device's monotonic time. */
  positionAt: (localNow: number) => number;
  moving: boolean;
  durationMs: number;
  disabled: boolean;
  onSeek: (positionMs: number) => void;
}) {
  const now = useTicker(500, moving);
  const positionMs = positionAt(now);
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
