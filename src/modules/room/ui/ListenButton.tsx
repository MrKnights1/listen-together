import { Icon } from "@/shared/ui/Icon.tsx";

/**
 * Browsers will not start sound without a click, so listening starts with
 * one — beside the player, never over it. Stopping is this listener's alone:
 * the room plays on for everyone else.
 */
export function ListenButton({
  listening,
  onStart,
  onStop,
}: {
  listening: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  return listening ? (
    <button type="button" className="button" onClick={onStop}>
      Stop listening
    </button>
  ) : (
    <button type="button" className="button button--primary button--large" onClick={onStart}>
      <Icon name="headphones" />
      Start listening
    </button>
  );
}
