import { describe, expect, test } from "bun:test";
import { readEnv } from "@/env.ts";

const VALID = {
  PORT: "3000",
  HOST: "127.0.0.1",
  APP_URL: "http://localhost:3000",
  APP_ENV: "development",
  DATABASE_PATH: "data/test.db",
  DISCORD_CLIENT_ID: "1234567890",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_REDIRECT_URI: "http://localhost:3000/api/auth/discord/callback",
  DISCORD_ALLOWED_USER_IDS: "80351110224678912, 123456789012345678",
  YOUTUBE_API_KEY: "key",
  YOUTUBE_REGION_CODE: "EE",
};

function readWith(overrides: Record<string, string | undefined>) {
  return () => readEnv({ ...VALID, ...overrides });
}

describe("readEnv", () => {
  test("reads a complete configuration", () => {
    const env = readEnv(VALID);

    expect(env.port).toBe(3000);
    expect(env.appUrl).toBe("http://localhost:3000");
    expect(env.development).toBe(true);
    expect(env.discordHostIds).toEqual(["80351110224678912", "123456789012345678"]);
    expect(env.youtubeRegionCode).toBe("EE");
  });

  test.each(Object.keys(VALID))("refuses to start without %s", (name) => {
    expect(readWith({ [name]: undefined })).toThrow(name);
  });

  test("treats a blank value as missing", () => {
    expect(readWith({ YOUTUBE_API_KEY: "   " })).toThrow("YOUTUBE_API_KEY");
  });

  test("refuses a port outside 1–65535", () => {
    expect(readWith({ PORT: "70000" })).toThrow("PORT");
    expect(readWith({ PORT: "abc" })).toThrow("PORT");
  });

  test("refuses an APP_ENV that is neither development nor production", () => {
    expect(readWith({ APP_ENV: "staging" })).toThrow("APP_ENV");
  });

  test("refuses an APP_URL with a path, because it is compared to the Origin header", () => {
    expect(readWith({ APP_URL: "http://localhost:3000/app" })).toThrow("APP_URL");
  });

  test("normalises a trailing slash off APP_URL", () => {
    expect(readEnv({ ...VALID, APP_URL: "http://localhost:3000/" }).appUrl).toBe(
      "http://localhost:3000",
    );
  });

  test("refuses plain http in production, where cookies are Secure", () => {
    expect(readWith({ APP_ENV: "production" })).toThrow("https");
  });

  test("accepts https in production", () => {
    const env = readEnv({
      ...VALID,
      APP_ENV: "production",
      APP_URL: "https://music.example.com",
      DISCORD_REDIRECT_URI: "https://music.example.com/api/auth/discord/callback",
    });

    expect(env.development).toBe(false);
  });

  test("refuses a Discord redirect on another origin, where the session cookie would not land", () => {
    expect(
      readWith({ DISCORD_REDIRECT_URI: "https://evil.example/api/auth/discord/callback" }),
    ).toThrow("DISCORD_REDIRECT_URI");
  });

  test("refuses a whitelist entry that is not a Discord id", () => {
    expect(readWith({ DISCORD_ALLOWED_USER_IDS: "80351110224678912,alice" })).toThrow("alice");
  });

  test("refuses a whitelist that is only commas", () => {
    expect(readWith({ DISCORD_ALLOWED_USER_IDS: " , ," })).toThrow("at least one");
  });

  test("drops duplicate whitelist entries", () => {
    expect(
      readEnv({ ...VALID, DISCORD_ALLOWED_USER_IDS: "80351110224678912,80351110224678912" })
        .discordHostIds,
    ).toEqual(["80351110224678912"]);
  });

  test("refuses a region code that is not two capital letters", () => {
    expect(readWith({ YOUTUBE_REGION_CODE: "est" })).toThrow("YOUTUBE_REGION_CODE");
  });
});
