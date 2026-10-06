/**
 * RelevX CRM link. When someone gets the campaign's link (DM sent, or public
 * reply on Threads/YouTube), they go into the CRM as a lead: name, network,
 * campaign and what they commented. Optional — only runs when CRM_HOOK_URL
 * and CRM_HOOK_KEY are set (CRM_HOOK_URL = https://crm.relevx.com/hook/openreply).
 * It never blocks or fails a send: errors are only logged.
 */
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
