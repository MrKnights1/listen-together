import type { Clock } from "@/shared/domain/Clock.ts";
import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";
import type { DiscordProfile } from "@/modules/identity/domain/DiscordIdentity.ts";
import type { Session } from "@/modules/identity/domain/Session.ts";
import { User } from "@/modules/identity/domain/User.ts";
import type { DiscordOAuth } from "@/modules/identity/domain/ports/DiscordOAuth.ts";
import type { SessionRepository } from "@/modules/identity/domain/ports/SessionRepository.ts";
import type { TokenGenerator } from "@/modules/identity/domain/ports/TokenGenerator.ts";
import type { UserRepository } from "@/modules/identity/domain/ports/UserRepository.ts";

/** A whitelisted Discord account, and one that is not on the list. */
export const ADA_DISCORD_ID = "80351110224678912";
export const STRANGER_DISCORD_ID = "123456789012345678";

export function adaProfile(overrides: Partial<DiscordProfile> = {}): DiscordProfile {
  return {
    id: ADA_DISCORD_ID,
    username: "ada",
    globalName: "Ada Lovelace",
    avatarHash: null,
    ...overrides,
  };
}

/** Time under the test's control, so expiry rules never depend on waiting. */
export class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.byId.get(id) ?? null;
  }

  async findByIds(ids: string[]): Promise<User[]> {
    // Absent ids are left out rather than becoming holes, the same as the adapter's `IN`.
    return ids.map((id) => this.byId.get(id)).filter((user): user is User => user !== undefined);
  }

  async findByDiscordId(discordId: string): Promise<User | null> {
    for (const user of this.byId.values()) {
      if (user.discordId === discordId) return user;
    }
    return null;
  }

  /** Mirrors the SQLite upsert: keyed on the Discord account, `id` and `createdAt` fixed once. */
  async save(user: User): Promise<User> {
    const existing = await this.findByDiscordId(user.discordId);
    const stored =
      existing === null
        ? user
        : User.restore({ ...user.toSnapshot(), id: existing.id, createdAt: existing.createdAt });

    this.byId.set(stored.id, stored);
    return stored;
  }

  count(): number {
    return this.byId.size;
  }
}

export class InMemorySessionRepository implements SessionRepository {
  private readonly byTokenHash = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.byTokenHash.set(session.tokenHash, session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.byTokenHash.get(tokenHash) ?? null;
  }

  async delete(tokenHash: string): Promise<void> {
    this.byTokenHash.delete(tokenHash);
  }

  async deleteExpired(now: Date): Promise<number> {
    let removed = 0;
    for (const [tokenHash, session] of this.byTokenHash) {
      if (session.isExpired(now)) {
        this.byTokenHash.delete(tokenHash);
        removed += 1;
      }
    }
    return removed;
  }

  count(): number {
    return this.byTokenHash.size;
  }
}

/** Predictable tokens, so assertions can name the exact value expected. */
export class SequenceTokenGenerator implements TokenGenerator {
  readonly issued: string[] = [];

  constructor(private readonly prefix = "token") {}

  generate(): string {
    const token = `${this.prefix}-${this.issued.length + 1}`;
    this.issued.push(token);
    return token;
  }

  hash(token: string): string {
    return `hash(${token})`;
  }
}

export class SequenceIdGenerator implements IdGenerator {
  private issued = 0;

  newId(): string {
    this.issued += 1;
    return `user-${this.issued}`;
  }
}

export class StubDiscordOAuth implements DiscordOAuth {
  readonly exchanges: Array<{ code: string; codeVerifier: string }> = [];
  profile: DiscordProfile = adaProfile();
  failure: Error | null = null;

  async authorizationUrl(state: string, codeVerifier: string): Promise<string> {
    return `https://discord.example/oauth2/authorize?state=${encodeURIComponent(state)}&verifier=${encodeURIComponent(codeVerifier)}`;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<DiscordProfile> {
    this.exchanges.push({ code, codeVerifier });
    if (this.failure !== null) throw this.failure;
    return this.profile;
  }
}
