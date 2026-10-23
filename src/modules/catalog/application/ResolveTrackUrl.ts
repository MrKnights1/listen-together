import { UnsupportedTrackUrl } from "@/modules/catalog/domain/errors.ts";
import type { LinkScope } from "@/modules/catalog/domain/LinkScope.ts";
import type { Resolution } from "@/modules/catalog/domain/Resolution.ts";
import type { TrackResolver } from "@/modules/catalog/domain/ports/TrackResolver.ts";
import { parseTrackUrl } from "@/modules/catalog/domain/trackUrl.ts";

/** What somebody pasted, turned into tracks by whichever provider recognises the link. */
export class ResolveTrackUrl {
  constructor(private readonly resolvers: TrackResolver[]) {}

  /** At most `limit` playable tracks; see `TrackResolver.resolve`. */
  async execute(pasted: string, scope: LinkScope, limit: number): Promise<Resolution> {
    const url = parseTrackUrl(pasted);
    const resolver = this.resolvers.find((candidate) => candidate.recognizes(url));
    if (resolver === undefined) throw new UnsupportedTrackUrl();
    return await resolver.resolve(url, scope, limit);
  }
}
