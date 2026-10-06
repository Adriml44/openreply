/**
 * Connecting Facebook Pages, Threads and YouTube. Each network has its own
 * OAuth; once through, the account is saved in the same table as Instagram
 * accounts (id prefixed, platform set) so campaigns, logs and stats just work.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { auth } from "@/lib/auth";
import { getBaseUrl, getMetaGraphApiVersion } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { createOAuthState, encryptToken, verifyOAuthState } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { type Platform, withPrefix } from "./ids";
import { subscribeFacebookPage } from "./platforms";

const ENV: Record<Exclude<Platform, "INSTAGRAM">, string[]> = {
  FACEBOOK: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
  THREADS: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
  YOUTUBE: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
};
const slug = (p: Platform) => p.toLowerCase();
const redirectUri = (p: Platform) => `${getBaseUrl()}/api/${slug(p)}/callback`;
const back = (p: Platform, status: string, extra = "") => NextResponse.redirect(`${getBaseUrl()}/settings?${slug(p)}=${status}${extra}`);

/** GET /api/<red>/connect → the network's login page. */
export async function startConnect(platform: Exclude<Platform, "INSTAGRAM">) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`);
  if (!canManageWorkspace(context.role)) return back(platform, "forbidden");
  const missing = ENV[platform].filter((k) => !process.env[k]);
  if (missing.length) return back(platform, "misconfigured", `&missing=${encodeURIComponent(missing.join(","))}`);
  const state = createOAuthState(context.workspaceId);
  const ru = redirectUri(platform);
  let url: URL;
  if (platform === "FACEBOOK") {
    url = new URL(`https://www.facebook.com/${getMetaGraphApiVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", process.env.FACEBOOK_APP_ID!);
    url.searchParams.set("scope", "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_engagement,pages_read_user_content,pages_messaging,business_management");
  } else if (platform === "THREADS") {
    url = new URL("https://threads.net/oauth/authorize");
    url.searchParams.set("client_id", process.env.THREADS_APP_ID!);
    url.searchParams.set("scope", "threads_basic,threads_read_replies,threads_manage_replies,threads_content_publish");
  } else {
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
    url.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.force-ssl");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
  }
  url.searchParams.set("redirect_uri", ru);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}

async function getJson<T>(res: Response): Promise<T> {
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((d?.error?.message ?? d?.error_description ?? d?.error ?? `HTTP ${res.status}`).toString().slice(0, 200));
  return d as T;
}

async function save(workspaceId: string, platform: Platform, nativeId: string, username: string, name: string | null,
  token: string, expiresAt: Date | null, webhookSubscribed: boolean) {
  const instagramId = withPrefix(platform, nativeId);
  const can = await canConnectInstagramAccount({ workspaceId, instagramId });
  if (!can.allowed) return false;
  const data = { workspaceId, platform, username, name, accessToken: encryptToken(token), tokenExpiresAt: expiresAt, webhookSubscribed };
  await prisma.instagramAccount.upsert({ where: { instagramId }, create: { instagramId, ...data }, update: data });
  return true;
}

/** GET /api/<red>/callback */
export async function finishConnect(platform: Exclude<Platform, "INSTAGRAM">, params: URLSearchParams) {
  const code = params.get("code");
  const state = verifyOAuthState(params.get("state"));
  if (params.get("error")) return back(platform, "denied");
  if (!code || !state) return back(platform, "invalid");
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(`${getBaseUrl()}/login`);
  const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: state.workspaceId, userId: session.user.id } });
  if (!member || !canManageWorkspace(member.role)) return back(platform, "forbidden");
  const ru = redirectUri(platform);

  try {
    let saved = 0;
    if (platform === "FACEBOOK") {
      const g = `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
      const short = await getJson<{ access_token: string }>(await fetch(`${g}/oauth/access_token?` + new URLSearchParams({
        client_id: process.env.FACEBOOK_APP_ID!, client_secret: process.env.FACEBOOK_APP_SECRET!, redirect_uri: ru, code })));
      const long = await getJson<{ access_token: string }>(await fetch(`${g}/oauth/access_token?` + new URLSearchParams({
        grant_type: "fb_exchange_token", client_id: process.env.FACEBOOK_APP_ID!, client_secret: process.env.FACEBOOK_APP_SECRET!, fb_exchange_token: short.access_token })));
      // Page tokens obtained from a long-lived user token do not expire.
      const pages = await getJson<{ data: Array<{ id: string; name: string; access_token: string }> }>(
        await fetch(`${g}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(long.access_token)}`));
      for (const page of pages.data) {
        let sub = false;
        try { sub = await subscribeFacebookPage(page.id, page.access_token); } catch (e) { console.warn("[Facebook] subscribe failed", e); }
        if (await save(state.workspaceId, "FACEBOOK", page.id, page.name, page.name, page.access_token, null, sub)) saved++;
      }
      if (!pages.data.length) return back(platform, "failed", "&reason=" + encodeURIComponent("Esa cuenta no administra ninguna página de Facebook"));
    } else if (platform === "THREADS") {
      const short = await getJson<{ access_token: string; user_id: string }>(await fetch("https://graph.threads.net/oauth/access_token", {
        method: "POST", body: new URLSearchParams({ client_id: process.env.THREADS_APP_ID!, client_secret: process.env.THREADS_APP_SECRET!,
          grant_type: "authorization_code", redirect_uri: ru, code }) }));
      const long = await getJson<{ access_token: string; expires_in: number }>(await fetch("https://graph.threads.net/access_token?" + new URLSearchParams({
        grant_type: "th_exchange_token", client_secret: process.env.THREADS_APP_SECRET!, access_token: short.access_token })));
      const me = await getJson<{ id: string; username: string; name?: string }>(
        await fetch(`https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(long.access_token)}`));
      if (await save(state.workspaceId, "THREADS", me.id, me.username, me.name ?? null, long.access_token,
        new Date(Date.now() + long.expires_in * 1000), false)) saved++;
    } else {
      const t = await getJson<{ access_token: string; refresh_token?: string }>(await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          grant_type: "authorization_code", redirect_uri: ru, code }) }));
      if (!t.refresh_token) throw new Error("Google no ha dado acceso permanente. Quita OpenReply en myaccount.google.com/permissions y vuelve a conectar.");
      const ch = await getJson<{ items?: Array<{ id: string; snippet: { title: string; customUrl?: string } }> }>(
        await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: `Bearer ${t.access_token}` } }));
      const c = ch.items?.[0];
      if (!c) throw new Error("Esa cuenta de Google no tiene canal de YouTube");
      // YouTube keeps the refresh token: access tokens are minted on demand.
      if (await save(state.workspaceId, "YOUTUBE", c.id, c.snippet.customUrl ?? c.snippet.title, c.snippet.title, t.refresh_token, null, false)) saved++;
    }
    if (!saved) return back(platform, "already_connected");
    return NextResponse.redirect(`${getBaseUrl()}/dashboard?connected=${slug(platform)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.operationalEvent.create({ data: { source: "SYSTEM", level: "ERROR", workspaceId: state.workspaceId,
      message: `${platform} connection failed`, payload: { reason: message } } }).catch(() => {});
    return back(platform, "failed", `&reason=${encodeURIComponent(message.slice(0, 200))}`);
  }
}
