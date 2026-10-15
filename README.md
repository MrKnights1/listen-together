# musicplayer

A self-hosted "listen together" music player: one shared room where whitelisted friends paste
YouTube songs and playlists into a fair, shared queue and everyone hears the same song at the
same moment.

The server never handles audio: each browser plays the song from YouTube's own embedded player
(a visible 200×200 tile, as YouTube requires) and keeps it on the room's clock.

## Running it

```sh
bun install
cp .env.example .env    # then fill in every value; the server refuses to start without one
bun run dev             # http://localhost:3000
```

Signing in needs a Discord application (OAuth2 redirect
`http://localhost:3000/api/auth/discord/callback`) and your Discord user ID in
`DISCORD_ALLOWED_USER_IDS`. Adding songs needs a YouTube Data API v3 key.
