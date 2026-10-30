/**
 * RelevX CRM link. When someone gets the campaign's link (DM sent, or public
 * reply on Threads/YouTube), they go into the CRM as a lead: name, network,
 * campaign and what they commented. Optional — only runs when CRM_HOOK_URL
 * and CRM_HOOK_KEY are set (CRM_HOOK_URL = https://crm.relevx.com/hook/openreply).
 * It never blocks or fails a send: errors are only logged.
 */
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/client";
import type { Platform } from "@/lib/social/ids";
import { PLATFORM_LABEL, rawId } from "@/lib/social/ids";

export async function notifyCrmLead(lead: {
  automationName: string;
  platform: Platform;
  commenterName?: string | null;
  commenterId: string;
  commentText: string;
}): Promise<void> {
  const url = process.env.CRM_HOOK_URL;
  const key = process.env.CRM_HOOK_KEY;
  if (!url || !key) return;
  const red = PLATFORM_LABEL[lead.platform];
  const usuario = lead.commenterName ?? rawId(lead.commenterId);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Clave": key },
      body: JSON.stringify({
        nombre: usuario,
        canal: lead.platform === "INSTAGRAM" ? "instagram" : lead.platform.toLowerCase(),
        origen: "openreply",
        instagram: lead.platform === "INSTAGRAM" ? usuario : undefined,
        mensaje: `${red} · campaña «${lead.automationName}» · comentó: «${lead.commentText.slice(0, 300)}»`,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.warn("[CRM] lead not sent:", error instanceof Error ? error.message : error);
  }
}

/**
 * The other direction: the CRM creating campaigns (it publishes reels on its
 * own and then attaches a campaign to each one). It sends the shared key in
 * `X-Clave`; the campaign goes to the workspace that owns the account it
 * targets, so the key cannot reach accounts outside this instance. Off unless
 * CRM_API_KEY is set.
 */
export function crmKeyMatches(sent: string | null | undefined, expected = process.env.CRM_API_KEY): boolean {
  // Pasted keys often carry a trailing newline: compare them trimmed.
  const want = expected?.trim();
  const got = sent?.trim();
  if (!want || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function workspaceFromCrmKey(
  sentKey: string | null,
  instagramAccountId: unknown
): Promise<string | null> {
  if (!crmKeyMatches(sentKey) || typeof instagramAccountId !== "string" || !instagramAccountId) return null;
  const account = await prisma.instagramAccount.findUnique({
    where: { id: instagramAccountId },
    select: { workspaceId: true },
  });
  return account?.workspaceId ?? null;
}
