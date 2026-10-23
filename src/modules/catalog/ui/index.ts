/**
 * Browser-side surface of the catalog module: the pure link rules the add
 * form needs before it sends anything. Separate from `../index.ts`, which is
 * the server surface and reaches `bun:sqlite` — never allowed in a bundle.
 */
export { offersPlaylistChoice } from "@/modules/catalog/domain/LinkScope.ts";
export { songLinkOf } from "@/modules/catalog/domain/songLink.ts";
