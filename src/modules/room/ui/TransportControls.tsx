import type { RepeatMode } from "@/modules/room/domain/RoomState.ts";
import { Icon } from "@/shared/ui/Icon.tsx";

const REPEAT_NEXT: Record<RepeatMode, RepeatMode> = { off: "all", all: "one", one: "off" };
const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Repeat is off",
  all: "Repeating the whole queue",
  one: "Repeating this song",
};

/**
 * Play and skip around a big round key, shuffle and repeat beside them. Two
 * groups so each can sit where the layout wants it; both act for everyone.
 */
export function TransportControls({
  status,
  repeat,
  shuffle,
  onToggle,
  onSkip,
  onShuffle,
  onRepeat,
}: {
  status: "playing" | "paused" | "idle";
  repeat: RepeatMode;
  shuffle: boolean;
  onToggle: () => void;
  onSkip: () => void;
  onShuffle: (on: boolean) => void;
  onRepeat: (mode: RepeatMode) => void;
}) {
  const shuffleLabel = shuffle ? "Shuffle is on" : "Shuffle is off";
  const idle = status === "idle";
  const toggle = status === "playing" ? "Pause" : "Resume";
  return (
    <>
      <div className="transport" role="group" aria-label="Room playback (for everyone)">
        <button
          type="button"
          className="play"
          disabled={idle}
          aria-label={toggle}
          title={toggle}
          onClick={onToggle}
        >
          <Icon name={status === "playing" ? "pause" : "play"} />
        </button>
        <button
          type="button"
          className="round"
          disabled={idle}
          aria-label="Skip"
          title="Skip"
          onClick={onSkip}
        >
          <Icon name="skip" />
        </button>
      </div>
      <div className="modes" role="group" aria-label="Room order (for everyone)">
        <button
          type="button"
          className="icon-button"
          aria-label={shuffleLabel}
          title={shuffleLabel}
          aria-pressed={shuffle}
          onClick={() => onShuffle(!shuffle)}
        >
          <Icon name="shuffle" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={REPEAT_LABEL[repeat]}
          title={REPEAT_LABEL[repeat]}
          aria-pressed={repeat !== "off"}
          onClick={() => onRepeat(REPEAT_NEXT[repeat])}
        >
          <Icon name={repeat === "one" ? "repeat-one" : "repeat"} />
        </button>
      </div>
    </>
  );
}
