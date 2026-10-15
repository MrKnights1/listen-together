/**
 * Browser surface of the room module. Separate from `../index.ts`, which is
 * the server surface and reaches `bun:sqlite` — never allowed in a bundle.
 */
export { RoomPage } from "./RoomPage.tsx";
