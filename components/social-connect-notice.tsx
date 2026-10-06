"use client";

import { useSearchParams } from "next/navigation";

/* Result of connecting Facebook, Threads or YouTube (?facebook=…, ?threads=…, ?youtube=…). */
const NETWORKS = { facebook: "Facebook", threads: "Threads", youtube: "YouTube" } as const;
const TEXT: Record<string, string> = {
  denied: "you cancelled the permission prompt. Try again and accept every permission.",
  invalid: "the login link expired. Click Connect again.",
  forbidden: "only workspace owners and admins can connect accounts.",
  already_connected: "that account is already connected to another workspace.",
  misconfigured: "the app keys for this network are missing on the server",
  failed: "the connection failed",
};

export function SocialConnectNotice() {
  const params = useSearchParams();
  for (const [key, label] of Object.entries(NETWORKS)) {
    const status = params?.get(key);
    if (!status) continue;
    const extra = params?.get("reason") ?? params?.get("missing");
    return (
      <div className="rounded border border-warning/20 bg-warning/10 p-4 text-sm text-warning">
        <strong>{label}:</strong> {TEXT[status] ?? status}
        {extra ? ` (${extra})` : ""}.
      </div>
    );
  }
  return null;
}
