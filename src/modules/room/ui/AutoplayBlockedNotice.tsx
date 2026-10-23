import { Icon } from "@/shared/ui/Icon.tsx";
import { AUTOPLAY_BLOCKED } from "./wording.ts";

/** The browser refused to start the sound: say so beside the button that starts it again. */
export function AutoplayBlockedNotice({ blocked }: { blocked: boolean }) {
  if (!blocked) return null;
  return (
    <p className="listen-blocked" role="status">
      <Icon name="alert" />
      {AUTOPLAY_BLOCKED}
    </p>
  );
}
