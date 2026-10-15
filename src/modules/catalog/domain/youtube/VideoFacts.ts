/**
 * What the YouTube Data API says about one video, flattened to what the
 * eligibility rules and the track need. The adapter builds this; nothing here
 * knows the API's JSON shape.
 */
export interface VideoFacts {
  videoId: string;
  title: string;
  channelTitle: string;
  /** `contentDetails.duration`, still in ISO 8601. */
  isoDuration: string;
  thumbnailUrl: string | null;
  privacyStatus: string;
  uploadStatus: string;
  embeddable: boolean;
  liveBroadcastContent: string;
  ageRestricted: boolean;
  /** `contentDetails.regionRestriction`; at most one list is present. */
  regionRestriction: { allowed?: string[]; blocked?: string[] } | null;
}
