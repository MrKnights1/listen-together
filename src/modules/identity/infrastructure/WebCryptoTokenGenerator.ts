import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";

/** 32 bytes = 256 bits of entropy. Guessing one is not a realistic attack. */
const TOKEN_BYTES = 32;

export class WebCryptoTokenGenerator implements TokenGenerator {
  /**
   * Uses the CSPRNG, never Math.random — these values are the only thing
   * standing between a stranger and someone else's account.
   */
  generate(): string {
    const bytes = new Uint8Array(TOKEN_BYTES);
    crypto.getRandomValues(bytes);
    return Buffer.from(bytes).toString("base64url");
  }

  hash(token: string): string {
    return new Bun.CryptoHasher("sha256").update(token, "utf8").digest("hex");
  }
}
