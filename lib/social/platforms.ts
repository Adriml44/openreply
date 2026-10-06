/**
 * Facebook Pages, Threads and YouTube: the calls OpenReply needs on each one
 * (recent posts, recent comments, public reply). Everything returns the same
 * shapes as the Instagram client (InstagramMedia / InstagramComment) with ids
 * already prefixed, so the reconciler and the worker don't care which network
 * a comment came from.
 */
import { getMetaGraphApiVersion } from "@/lib/env";
import type { InstagramComment, InstagramMedia } from "@/lib/meta/client";
import { platformOf, rawId, withPrefix } from "./ids";

const fb = () => `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
const THREADS = "https://graph.threads.net/v1.0";
const YT = "https://www.googleapis.com/youtube/v3";

export class PlatformApiError extends Error {
  constructor(public platform: string, public status: number, message: string) {
    super(`${platform}: ${message}`);
  }
}

async function json<T>(platform: string, res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const d = data as { error?: { message?: string } | string } | null;
    const msg = typeof d?.error === "string" ? d.error : d?.error?.message ?? text.slice(0, 200);
    throw new PlatformApiError(platform, res.status, msg || `HTTP ${res.status}`);
  }
  return data as T;
}

/* ------------------------------------------------------------ YouTube token */
// YouTube accounts store the (encrypted) refresh token; access tokens live 1 h.
const ytTokens = new Map<string, { token: string; until: number }>();

export async function youtubeAccessToken(refreshToken: string): Promise<string> {
  const hit = ytTokens.get(refreshToken);
  if (hit && hit.until > Date.now() + 60_000) return hit.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const d = await json<{ access_token: string; expires_in: number }>("YouTube", res);
  ytTokens.set(refreshToken, { token: d.access_token, until: Date.now() + d.expires_in * 1000 });
  return d.access_token;
}

/* -------------------------------------------------------------- recent posts */
export async function getPlatformMedia(accountId: string, token: string, limit = 25): Promise<InstagramMedia[]> {
  const platform = platformOf(accountId);
  if (platform === "FACEBOOK") {
    const u = new URL(`${fb()}/${rawId(accountId)}/published_posts`);
    u.searchParams.set("fields", "id,message,full_picture,permalink_url,created_time");
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("access_token", token);
    const d = await json<{ data: Array<{ id: string; message?: string; full_picture?: string; permalink_url?: string; created_time: string }> }>("Facebook", await fetch(u));
    return d.data.map((p) => ({ id: withPrefix("FACEBOOK", p.id), caption: p.message, media_type: "POST", media_url: p.full_picture,
      thumbnail_url: p.full_picture, timestamp: p.created_time, permalink: p.permalink_url }));
  }
  if (platform === "THREADS") {
    const u = new URL(`${THREADS}/me/threads`);
    u.searchParams.set("fields", "id,text,permalink,timestamp,media_type,media_url,thumbnail_url");
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("access_token", token);
    const d = await json<{ data: Array<{ id: string; text?: string; permalink?: string; timestamp: string; media_type?: string; media_url?: string; thumbnail_url?: string }> }>("Threads", await fetch(u));
    return d.data.filter((p) => p.media_type !== "REPOST_FACADE").map((p) => ({ id: withPrefix("THREADS", p.id), caption: p.text,
      media_type: p.media_type ?? "TEXT_POST", media_url: p.media_url, thumbnail_url: p.thumbnail_url ?? p.media_url, timestamp: p.timestamp, permalink: p.permalink }));
  }
  if (platform === "YOUTUBE") {
    const access = await youtubeAccessToken(token);
    const h = { headers: { Authorization: `Bearer ${access}` } };
    const ch = await json<{ items: Array<{ contentDetails: { relatedPlaylists: { uploads: string } } }> }>("YouTube",
      await fetch(`${YT}/channels?part=contentDetails&mine=true`, h));
    const uploads = ch.items?.[0]?.contentDetails.relatedPlaylists.uploads;
    if (!uploads) return [];
    const pl = await json<{ items: Array<{ snippet: { title: string; publishedAt: string; resourceId: { videoId: string }; thumbnails?: { medium?: { url: string } } } }> }>("YouTube",
      await fetch(`${YT}/playlistItems?part=snippet&maxResults=${Math.min(50, limit)}&playlistId=${uploads}`, h));
    return pl.items.map((v) => ({ id: withPrefix("YOUTUBE", v.snippet.resourceId.videoId), caption: v.snippet.title, media_type: "VIDEO",
      thumbnail_url: v.snippet.thumbnails?.medium?.url, media_url: v.snippet.thumbnails?.medium?.url, timestamp: v.snippet.publishedAt,
      permalink: `https://youtu.be/${v.snippet.resourceId.videoId}` }));
  }
  throw new Error("getPlatformMedia is not for Instagram");
}

/* ---------------------------------------------------------- recent comments */
export async function getPlatformComments(accountId: string, token: string, mediaId: string, sinceMs: number): Promise<InstagramComment[]> {
  const platform = platformOf(accountId);
  const recent = (iso: string) => Date.parse(iso) >= sinceMs;
  if (platform === "FACEBOOK") {
    const u = new URL(`${fb()}/${rawId(mediaId)}/comments`);
    u.searchParams.set("fields", "id,message,created_time,from{id,name},comments.limit(25){from{id}}");
    u.searchParams.set("filter", "toplevel");
    u.searchParams.set("order", "reverse_chronological");
    u.searchParams.set("limit", "100");
    u.searchParams.set("access_token", token);
    const d = await json<{ data: Array<{ id: string; message?: string; created_time: string; from?: { id: string; name?: string }; comments?: { data: Array<{ id: string; from?: { id: string } }> } }> }>("Facebook", await fetch(u));
    return d.data.filter((c) => recent(c.created_time)).map((c) => ({
      id: withPrefix("FACEBOOK", c.id), text: c.message ?? "", timestamp: c.created_time,
      from: c.from ? { id: withPrefix("FACEBOOK", c.from.id), username: c.from.name } : undefined,
      replies: { data: (c.comments?.data ?? []).map((r) => ({ id: r.id, from: r.from ? { id: withPrefix("FACEBOOK", r.from.id) } : undefined })) },
    }));
  }
  if (platform === "THREADS") {
    // Threads gives the author's username (not an id): it works as their id here.
    const u = new URL(`${THREADS}/${rawId(mediaId)}/replies`);
    u.searchParams.set("fields", "id,text,username,timestamp,hide_status");
    u.searchParams.set("reverse", "true");
    u.searchParams.set("access_token", token);
    const d = await json<{ data: Array<{ id: string; text?: string; username?: string; timestamp: string; hide_status?: string }> }>("Threads", await fetch(u));
    return d.data.filter((c) => recent(c.timestamp) && c.hide_status !== "HIDDEN" && c.username).map((c) => ({
      id: withPrefix("THREADS", c.id), text: c.text ?? "", timestamp: c.timestamp,
      from: { id: withPrefix("THREADS", c.username!), username: c.username },
    }));
  }
  if (platform === "YOUTUBE") {
    const access = await youtubeAccessToken(token);
    const u = new URL(`${YT}/commentThreads`);
    u.searchParams.set("part", "snippet,replies");
    u.searchParams.set("videoId", rawId(mediaId));
    u.searchParams.set("order", "time");
    u.searchParams.set("maxResults", "100");
    u.searchParams.set("textFormat", "plainText");
    const d = await json<{ items: Array<{ id: string; snippet: { topLevelComment: { snippet: { textOriginal: string; authorDisplayName: string; authorChannelId?: { value: string }; publishedAt: string } } };
      replies?: { comments: Array<{ id: string; snippet: { authorChannelId?: { value: string } } }> } }> }>("YouTube",
      await fetch(u, { headers: { Authorization: `Bearer ${access}` } }));
    return (d.items ?? []).filter((t) => recent(t.snippet.topLevelComment.snippet.publishedAt)).map((t) => {
      const s = t.snippet.topLevelComment.snippet;
      return {
        id: withPrefix("YOUTUBE", t.id), text: s.textOriginal ?? "", timestamp: s.publishedAt,
        from: s.authorChannelId ? { id: withPrefix("YOUTUBE", s.authorChannelId.value), username: s.authorDisplayName } : undefined,
        replies: { data: (t.replies?.comments ?? []).map((r) => ({ id: r.id, from: r.snippet.authorChannelId ? { id: withPrefix("YOUTUBE", r.snippet.authorChannelId.value) } : undefined })) },
      };
    });
  }
  throw new Error("getPlatformComments is not for Instagram");
}

/* ------------------------------------------------------------- public reply */
export async function sendPlatformCommentReply(token: string, commentId: string, message: string): Promise<{ id: string }> {
  const platform = platformOf(commentId);
  if (platform === "FACEBOOK") {
    return json("Facebook", await fetch(`${fb()}/${rawId(commentId)}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message }),
    }));
  }
  if (platform === "THREADS") {
    // Two steps on Threads: create the reply container, then publish it.
    const c = new URL(`${THREADS}/me/threads`);
    c.searchParams.set("media_type", "TEXT");
    c.searchParams.set("text", message.slice(0, 500));
    c.searchParams.set("reply_to_id", rawId(commentId));
    c.searchParams.set("access_token", token);
    const created = await json<{ id: string }>("Threads", await fetch(c, { method: "POST" }));
    const p = new URL(`${THREADS}/me/threads_publish`);
    p.searchParams.set("creation_id", created.id);
    p.searchParams.set("access_token", token);
    return json("Threads", await fetch(p, { method: "POST" }));
  }
  if (platform === "YOUTUBE") {
    const access = await youtubeAccessToken(token);
    const r = await json<{ id: string }>("YouTube", await fetch(`${YT}/comments?part=snippet`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
      body: JSON.stringify({ snippet: { parentId: rawId(commentId), textOriginal: message.slice(0, 9000) } }),
    }));
    return { id: r.id };
  }
  throw new Error("sendPlatformCommentReply is not for Instagram");
}

/* ------------------------------------------------- Facebook page connection */
export async function subscribeFacebookPage(pageId: string, pageToken: string): Promise<boolean> {
  const u = new URL(`${fb()}/${rawId(pageId)}/subscribed_apps`);
  u.searchParams.set("subscribed_fields", "feed,messages,messaging_postbacks,message_reads");
  u.searchParams.set("access_token", pageToken);
  const d = await json<{ success?: boolean }>("Facebook", await fetch(u, { method: "POST" }));
  return Boolean(d.success);
}
