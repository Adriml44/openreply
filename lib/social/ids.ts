/**
 * Multi-network ids.
 *
 * Instagram ids are stored as-is. Facebook, Threads and YouTube ids are stored
 * with a short prefix ("fb:", "th:", "yt:") everywhere they live — account ids,
 * post ids, comment ids, user ids. That keeps the whole pipeline (webhooks,
 * queue, DmLog, rate limits, dedup) unchanged, and lets the API clients route
 * each call to the right network just by looking at the id.
 */
export type Platform = "INSTAGRAM" | "FACEBOOK" | "THREADS" | "YOUTUBE";

const PREFIX: Record<Exclude<Platform, "INSTAGRAM">, string> = {
  FACEBOOK: "fb:",
  THREADS: "th:",
  YOUTUBE: "yt:",
};

export function platformOf(id: string | null | undefined): Platform {
  if (!id) return "INSTAGRAM";
  if (id.startsWith("fb:")) return "FACEBOOK";
  if (id.startsWith("th:")) return "THREADS";
  if (id.startsWith("yt:")) return "YOUTUBE";
  return "INSTAGRAM";
}

/** The id the network itself understands (prefix removed). */
export function rawId(id: string): string {
  return platformOf(id) === "INSTAGRAM" ? id : id.slice(3);
}

export function withPrefix(platform: Platform, id: string): string {
  if (platform === "INSTAGRAM") return id;
  const p = PREFIX[platform];
  return id.startsWith(p) ? id : p + id;
}

/** Threads and YouTube have no DMs in their APIs: campaigns there only reply in public. */
export function supportsDm(platform: Platform): boolean {
  return platform === "INSTAGRAM" || platform === "FACEBOOK";
}

/** Only Instagram tells us whether someone follows the account. */
export function canVerifyFollow(platform: Platform): boolean {
  return platform === "INSTAGRAM";
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  THREADS: "Threads",
  YOUTUBE: "YouTube",
};
