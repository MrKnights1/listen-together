import { PlaylistNotFound, ProviderUnavailable } from "@/modules/catalog/domain/errors.ts";
import type { YouTubeCatalog } from "@/modules/catalog/domain/ports/YouTubeCatalog.ts";
import type { VideoFacts } from "@/modules/catalog/domain/youtube/VideoFacts.ts";

/** https://developers.google.com/youtube/v3/docs */
export const YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3";

export interface YouTubeDataApiConfig {
  apiKey: string;
  /** Injected so the adapter can be tested against a local stand-in for YouTube. */
  baseUrl: string;
}

/** `videos.list` takes up to 50 ids, and `playlistItems.list` returns up to 50 per page. */
const PAGE_SIZE = 50;

/** Adding a song waits on these requests; a hung YouTube must not hang the room. */
const REQUEST_TIMEOUT_MS = 10_000;

interface VideoItem {
  id?: unknown;
  snippet?: {
    title?: unknown;
    channelTitle?: unknown;
    liveBroadcastContent?: unknown;
    thumbnails?: Record<string, { url?: unknown } | undefined>;
  };
  contentDetails?: {
    duration?: unknown;
    regionRestriction?: { allowed?: unknown; blocked?: unknown };
    contentRating?: { ytRating?: unknown };
  };
  status?: { privacyStatus?: unknown; uploadStatus?: unknown; embeddable?: unknown };
}

interface PlaylistPage {
  nextPageToken?: unknown;
  items?: { contentDetails?: { videoId?: unknown } }[];
}

interface ErrorBody {
  error?: { errors?: { reason?: unknown }[] };
}

const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;

/**
 * The YouTube Data API v3, read with an API key. The key travels in the query
 * string — the API's own design — so no URL from here is ever logged or put in
 * an error message.
 */
export class YouTubeDataApiClient implements YouTubeCatalog {
  constructor(private readonly config: YouTubeDataApiConfig) {}

  async videos(videoIds: string[]): Promise<VideoFacts[]> {
    const facts: VideoFacts[] = [];

    for (let start = 0; start < videoIds.length; start += PAGE_SIZE) {
      const batch = videoIds.slice(start, start + PAGE_SIZE);
      const body = (await this.get("videos", {
        part: "snippet,contentDetails,status",
        id: batch.join(","),
        maxResults: String(PAGE_SIZE),
      })) as { items?: VideoItem[] };

      for (const item of body.items ?? []) {
        const parsed = toVideoFacts(item);
        if (parsed !== null) facts.push(parsed);
      }
    }

    return facts;
  }

  async playlistVideoIds(
    playlistId: string,
    limit: number,
  ): Promise<{ videoIds: string[]; hasMore: boolean }> {
    const videoIds: string[] = [];
    let pageToken: string | null = null;

    for (;;) {
      const params: Record<string, string> = {
        part: "contentDetails",
        playlistId,
        maxResults: String(PAGE_SIZE),
      };
      if (pageToken !== null) params["pageToken"] = pageToken;

      const page = (await this.get("playlistItems", params, "playlist")) as PlaylistPage;
      for (const item of page.items ?? []) {
        const videoId = item.contentDetails?.videoId;
        if (typeof videoId === "string") videoIds.push(videoId);
      }

      const next = typeof page.nextPageToken === "string" ? page.nextPageToken : null;
      if (videoIds.length >= limit) {
        return {
          videoIds: videoIds.slice(0, limit),
          hasMore: videoIds.length > limit || next !== null,
        };
      }
      if (next === null) return { videoIds, hasMore: false };
      pageToken = next;
    }
  }

  private async get(
    resource: "videos" | "playlistItems",
    params: Record<string, string>,
    subject: "playlist" | null = null,
  ): Promise<unknown> {
    const url = new URL(`${this.config.baseUrl}/${resource}`);
    url.search = new URLSearchParams({ ...params, key: this.config.apiKey }).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // The error's own message can quote the URL, key and all.
      throw new ProviderUnavailable(
        `YouTube did not answer (${error instanceof Error ? error.name : "unknown error"}).`,
      );
    }

    if (response.ok) return await response.json();

    const reason = await errorReason(response);
    if (
      subject === "playlist" &&
      (response.status === 404 || reason === "playlistItemsNotAccessible")
    ) {
      throw new PlaylistNotFound();
    }
    if (reason === "quotaExceeded") {
      throw new ProviderUnavailable("The YouTube Data API quota is used up for today.");
    }
    throw new ProviderUnavailable(
      `YouTube answered ${resource} with HTTP ${response.status}${reason === null ? "" : ` (${reason})`}.`,
    );
  }
}

/** The first `errors[].reason` of a Google API error body, if the body is one. */
async function errorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as ErrorBody;
    const reason = body.error?.errors?.[0]?.reason;
    return typeof reason === "string" && /^[A-Za-z]{1,64}$/.test(reason) ? reason : null;
  } catch {
    return null;
  }
}

/** Null for an item missing what a track needs; it is then treated as not found. */
function toVideoFacts(item: VideoItem): VideoFacts | null {
  const { id, snippet, contentDetails, status } = item;
  if (typeof id !== "string" || snippet === undefined || contentDetails === undefined) return null;
  if (status === undefined) return null;
  if (typeof snippet.title !== "string" || typeof contentDetails.duration !== "string") return null;

  const thumbnails = snippet.thumbnails ?? {};
  const thumbnail = [thumbnails["medium"], thumbnails["high"], thumbnails["default"]]
    .map((candidate) => candidate?.url)
    .find((url): url is string => typeof url === "string");

  const restriction = contentDetails.regionRestriction;
  const allowed = strings(restriction?.allowed);
  const blocked = strings(restriction?.blocked);

  return {
    videoId: id,
    title: snippet.title,
    channelTitle: typeof snippet.channelTitle === "string" ? snippet.channelTitle : "",
    isoDuration: contentDetails.duration,
    thumbnailUrl: thumbnail ?? null,
    privacyStatus: typeof status.privacyStatus === "string" ? status.privacyStatus : "",
    uploadStatus: typeof status.uploadStatus === "string" ? status.uploadStatus : "",
    embeddable: status.embeddable === true,
    liveBroadcastContent:
      typeof snippet.liveBroadcastContent === "string" ? snippet.liveBroadcastContent : "",
    ageRestricted: contentDetails.contentRating?.ytRating === "ytAgeRestricted",
    regionRestriction:
      allowed !== undefined ? { allowed } : blocked !== undefined ? { blocked } : null,
  };
}
