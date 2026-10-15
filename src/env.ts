/**
 * Reads and validates process configuration once, at boot.
 *
 * Every value is required and none has a default: a missing or malformed
 * variable throws here rather than producing a half-configured server that
 * fails later, in a request, in front of a listener.
 */
export interface Env {
  port: number;
  /** The interface to listen on. `127.0.0.1` behind nginx; never guessed. */
  host: string;
  /** The public origin, without a trailing slash. Also the only Origin a socket may come from. */
  appUrl: string;
  /**
   * Serve development bundles and Bun's verbose error page. Stated outright
   * rather than inferred: that page carries source and absolute paths, so "is
   * this production?" must never have a default.
   */
  development: boolean;
  databasePath: string;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
  /** Discord user ids (snowflakes) allowed in. Never empty. */
  discordHostIds: string[];
  youtubeApiKey: string;
  /** ISO 3166-1 alpha-2. Videos blocked in this region are refused at add time. */
  youtubeRegionCode: string;
}

/** Discord snowflakes are 64-bit integers; 17–20 digits covers every id issued so far and for decades. */
const SNOWFLAKE = /^\d{17,20}$/;

function required(source: Record<string, string | undefined>, name: string): string {
  const value = source[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}. See .env.example.`);
  }
  return value.trim();
}

function url(source: Record<string, string | undefined>, name: string): URL {
  const value = required(source, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL, got: ${value}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${name} must be an http or https URL, got: ${value}`);
  }
  return parsed;
}

function allowedUserIds(source: Record<string, string | undefined>): string[] {
  const ids = required(source, "DISCORD_ALLOWED_USER_IDS")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id !== "");

  const malformed = ids.filter((id) => !SNOWFLAKE.test(id));
  if (malformed.length > 0) {
    throw new Error(
      `DISCORD_ALLOWED_USER_IDS must be comma-separated Discord user ids (17–20 digits). Not ids: ${malformed.join(", ")}`,
    );
  }
  if (ids.length === 0) {
    throw new Error("DISCORD_ALLOWED_USER_IDS must name at least one Discord user id.");
  }

  return [...new Set(ids)];
}

export function readEnv(source: Record<string, string | undefined> = Bun.env): Env {
  const port = Number(required(source, "PORT"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got: ${source["PORT"]}`);
  }

  const appEnv = required(source, "APP_ENV");
  if (appEnv !== "development" && appEnv !== "production") {
    throw new Error(`APP_ENV must be "development" or "production", got: ${appEnv}`);
  }
  const development = appEnv === "development";

  const appUrl = url(source, "APP_URL");
  if (appUrl.pathname !== "/" || appUrl.search !== "" || appUrl.hash !== "") {
    throw new Error(`APP_URL must be an origin with no path, got: ${appUrl.href}`);
  }
  // Session cookies are marked Secure in production; over http the browser would drop them.
  if (!development && appUrl.protocol !== "https:") {
    throw new Error(`APP_URL must be https in production, got: ${appUrl.href}`);
  }

  // The OAuth callback sets the session cookie, so it has to land on our own origin.
  const redirectUri = url(source, "DISCORD_REDIRECT_URI");
  if (redirectUri.origin !== appUrl.origin) {
    throw new Error(
      `DISCORD_REDIRECT_URI must be on APP_URL's origin (${appUrl.origin}), got: ${redirectUri.href}`,
    );
  }

  const regionCode = required(source, "YOUTUBE_REGION_CODE");
  if (!/^[A-Z]{2}$/.test(regionCode)) {
    throw new Error(
      `YOUTUBE_REGION_CODE must be a two-letter ISO 3166-1 code like EE, got: ${regionCode}`,
    );
  }

  return {
    port,
    host: required(source, "HOST"),
    appUrl: appUrl.origin,
    development,
    databasePath: required(source, "DATABASE_PATH"),
    discordClientId: required(source, "DISCORD_CLIENT_ID"),
    discordClientSecret: required(source, "DISCORD_CLIENT_SECRET"),
    discordRedirectUri: redirectUri.href,
    discordHostIds: allowedUserIds(source),
    youtubeApiKey: required(source, "YOUTUBE_API_KEY"),
    youtubeRegionCode: regionCode,
  };
}
