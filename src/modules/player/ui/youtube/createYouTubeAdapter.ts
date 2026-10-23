import type { PlayerAdapter, PlayerEvents } from "../PlayerAdapter.ts";
import { loadYouTubeIframeApi, type After, type IframeApiHost } from "./iframeApi.ts";
import { YouTubeIframeAdapter } from "./YouTubeIframeAdapter.ts";

/**
 * Makes a YouTube player inside `host`, in this browser page. The player
 * replaces the element it is given, so it is handed a fresh child each time
 * and `host` itself is never touched by anyone else.
 */
export async function createYouTubeAdapter(
  host: HTMLElement,
  events: PlayerEvents,
): Promise<PlayerAdapter> {
  const after: After = (ms, run) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  };
  const api = await loadYouTubeIframeApi(
    window as unknown as IframeApiHost,
    (src, onError) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onerror = () => {
        // Gone, so the next attempt adds a fresh one rather than finding this.
        script.remove();
        onError();
      };
      document.head.append(script);
    },
    after,
  );

  const mount = document.createElement("div");
  host.replaceChildren(mount);
  return await YouTubeIframeAdapter.create(api, mount, window.location.origin, events, after);
}
