"use client";

/**
 * Campaign Builder
 *
 * Two-pane campaign editor: a control panel on the left and a live phone
 * preview on the right. Used for both creating and editing a campaign.
 *
 * Turn 1 wires the fully-functional pieces: trigger scope (specific / any /
 * next post), match mode (specific words / any word), the opening + reveal DM
 * text, public reply, and the tracked link. Button-driven delivery and the
 * follow / email / follow-up steps arrive in later turns.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type AccountOption, accountLabel, PLATFORM_NAME } from "@/components/account-select";
import PostPicker from "@/components/post-picker";
import CampaignPreview, { type PreviewTab } from "@/components/campaign-preview";
import { readCache, writeCache } from "@/lib/client-cache";
import {
  IMPORT_QUEUE_KEY,
  IMPORT_ACCOUNT_KEY,
  type ImportRow,
} from "@/lib/import-queue";

type TriggerScope = "specific" | "any" | "next";
type MatchMode = "specific" | "any";

interface LoadedCampaign {
  id: string;
  name: string;
  postId: string | null;
  postUrl: string | null;
  pendingNextReel: boolean;
  matchAnyPost: boolean;
  keywords: string[];
  matchAnyWord: boolean;
  dmTriggerEnabled: boolean;
  dmMessage: string;
  openingDmEnabled: boolean;
  openingDmMessage: string | null;
  openingDmButtonLabel: string | null;
  linkButtonLabel: string | null;
  requireFollow: boolean;
  followPromptMessage: string | null;
  followPromptButtonLabel: string | null;
  followUpEnabled: boolean;
  followUpMessage: string | null;
  followUpDelayMinutes: number | null;
  publicReplyEnabled: boolean;
  publicReplyMessage: string | null;
  publicReplyMessages: string[];
  isActive: boolean;
  instagramAccountId: string;
  groupId?: string | null;
  trackedLinks?: { destinationUrl: string; label?: string | null }[];
}

/* Everything that can differ from one network to another inside the same
   campaign: which post, the public replies, the DMs, the follow gate. The
   campaign name and the keywords are shared. */
interface NetCfg {
  triggerScope: TriggerScope;
  postId: string | null;
  postUrl: string | null;
  postThumb: string | null;
  postCaption: string;
  dmTriggerEnabled: boolean;
  publicReplyEnabled: boolean;
  publicReplyMessages: string[];
  openingDmEnabled: boolean;
  openingDmMessage: string;
  openingDmButtonLabel: string;
  dmMessage: string;
  linkOpen: boolean;
  trackedDestinationUrl: string;
  linkButtonLabel: string;
  secondLinkOpen: boolean;
  secondaryDestinationUrl: string;
  secondaryButtonLabel: string;
  requireFollow: boolean;
  followPromptMessage: string;
  followPromptButtonLabel: string;
  followUpEnabled: boolean;
  followUpMessage: string;
  followUpDelayMinutes: number;
}

// Threads and YouTube have no DMs in their APIs: there the campaign only replies in public.
const isPublicOnly = (platform?: string) => platform === "THREADS" || platform === "YOUTUBE";

function cfgFromCampaign(c: LoadedCampaign): NetCfg {
  const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
  const second = c.trackedLinks?.[1];
  return {
    triggerScope: c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific",
    postId: c.postId, postUrl: c.postUrl, postThumb: null, postCaption: "",
    dmTriggerEnabled: c.dmTriggerEnabled ?? false,
    publicReplyEnabled: c.publicReplyEnabled,
    publicReplyMessages: c.publicReplyMessages?.length ? c.publicReplyMessages : c.publicReplyMessage ? [c.publicReplyMessage] : [""],
    openingDmEnabled: c.openingDmEnabled, openingDmMessage: c.openingDmMessage ?? "", openingDmButtonLabel: c.openingDmButtonLabel ?? "",
    dmMessage: c.dmMessage, linkOpen: Boolean(link), trackedDestinationUrl: link, linkButtonLabel: c.linkButtonLabel ?? "Open link",
    secondLinkOpen: Boolean(second?.destinationUrl), secondaryDestinationUrl: second?.destinationUrl ?? "", secondaryButtonLabel: second?.label ?? "Open link",
    requireFollow: c.requireFollow ?? false, followPromptMessage: c.followPromptMessage ?? "", followPromptButtonLabel: c.followPromptButtonLabel ?? "i'm following",
    followUpEnabled: c.followUpEnabled ?? false, followUpMessage: c.followUpMessage ?? "", followUpDelayMinutes: c.followUpDelayMinutes ?? 0,
  };
}

interface CampaignBuilderProps {
  mode: "new" | "edit";
  campaignId?: string;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

function Radio({
  checked,
  onSelect,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
        checked ? "border-accent bg-accent/5" : "border-border hover:border-border-hover"
      }`}
    >
      <span
        className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
          checked ? "border-accent" : "border-zinc-500"
        }`}
      >
        {checked && <span className="h-2 w-2 rounded-full bg-accent" />}
      </span>
      <span className="flex-1 text-foreground">{children}</span>
    </button>
  );
}

function Toggle({
  on,
  onToggle,
}: {
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-zinc-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}

export default function CampaignBuilder({ mode, campaignId }: CampaignBuilderProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(mode === "edit");
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(true);

  const [triggerScope, setTriggerScope] = useState<TriggerScope>("specific");
  const [postId, setPostId] = useState<string | null>(null);
  const [postUrl, setPostUrl] = useState<string | null>(null);
  const [postThumb, setPostThumb] = useState<string | null>(null);
  const [postCaption, setPostCaption] = useState("");

  // Post IDs already tied to another automation on this account, so the picker
  // can flag them and the user knows not to double-assign. Maps postId ->
  // the campaign name using it (for the tooltip).
  const [usedPosts, setUsedPosts] = useState<Record<string, string>>({});

  const [matchMode, setMatchMode] = useState<MatchMode>("specific");
  const [keywordText, setKeywordText] = useState("");
  const [dmTriggerEnabled, setDmTriggerEnabled] = useState(false);

  const [publicReplyEnabled, setPublicReplyEnabled] = useState(false);
  const [publicReplyMessages, setPublicReplyMessages] = useState<string[]>([""]);

  const [openingDmEnabled, setOpeningDmEnabled] = useState(false);
  const [openingDmMessage, setOpeningDmMessage] = useState("");
  const [openingDmButtonLabel, setOpeningDmButtonLabel] = useState("");

  const [dmMessage, setDmMessage] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [trackedDestinationUrl, setTrackedDestinationUrl] = useState("");
  const [linkButtonLabel, setLinkButtonLabel] = useState("Open link");
  const [secondLinkOpen, setSecondLinkOpen] = useState(false);
  const [secondaryDestinationUrl, setSecondaryDestinationUrl] = useState("");
  const [secondaryButtonLabel, setSecondaryButtonLabel] = useState("Open link");
  const [requireFollow, setRequireFollow] = useState(false);
  const [followPromptMessage, setFollowPromptMessage] = useState("");
  const [followPromptButtonLabel, setFollowPromptButtonLabel] =
    useState("i'm following");
  const [followUpEnabled, setFollowUpEnabled] = useState(false);
  const [followUpMessage, setFollowUpMessage] = useState("");
  const [followUpDelayMinutes, setFollowUpDelayMinutes] = useState(0);

  const [previewTab, setPreviewTab] = useState<PreviewTab>("dm");

  // Multi-network: the accounts in this campaign (tab order), the saved config
  // of every tab that is not on screen, and the campaign id behind each one.
  const [netOrder, setNetOrder] = useState<string[]>([]);
  const [netCfgs, setNetCfgs] = useState<Record<string, NetCfg>>({});
  const [netIds, setNetIds] = useState<Record<string, string>>({});
  const [groupId, setGroupId] = useState<string | null>(null);

  // CSV import queue. When present, each save advances to the next row instead
  // of returning to the campaigns list.
  const [importQueue, setImportQueue] = useState<ImportRow[] | null>(null);
  const [importTotal, setImportTotal] = useState(0);

  const keywords = useMemo(
    () =>
      keywordText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    [keywordText]
  );

  // Fetch the connected account's real avatar for the preview (cache-first so
  // it shows instantly on a return visit instead of a blank circle).
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    const cacheKey = `ig-avatar:${selectedAccountId}`;
    const cached = readCache<string | null>(cacheKey, 30 * 60 * 1000);
    // Hydrating state from cache is a legitimate effect use here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (cached.data !== null) setAvatarUrl(cached.data);

    const params = new URLSearchParams({ instagramAccountId: selectedAccountId });
    fetch(`/api/instagram/profile?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const url = d.success ? d.data.profilePictureUrl ?? null : null;
        setAvatarUrl(url);
        writeCache(cacheKey, url);
      })
      .catch(() => {
        if (!cancelled && cached.data === null) setAvatarUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  // Load accounts (both modes need them for the preview username + selector).
  useEffect(() => {
    fetch("/api/dashboard/stats")
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return;
        const next: AccountOption[] = payload.data.instagramAccounts ?? [];
        setAccounts(next);
        setSelectedAccountId(
          (prev) => prev || payload.data.selectedInstagramAccountId || next[0]?.id || ""
        );
      })
      .catch(() => setAccounts([]));
  }, []);

  // Prefill when editing.
  useEffect(() => {
    if (mode !== "edit" || !campaignId) return;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (!payload.success) return setNotFound(true);
        const all = payload.data as LoadedCampaign[];
        const c = all.find((x) => x.id === campaignId);
        if (!c) return setNotFound(true);
        // The same campaign on other networks (same groupId) is edited together.
        const group = c.groupId ? all.filter((x) => x.groupId === c.groupId) : [c];
        setGroupId(c.groupId ?? null);
        setNetOrder(group.map((x) => x.instagramAccountId));
        setNetIds(Object.fromEntries(group.map((x) => [x.instagramAccountId, x.id])));
        setNetCfgs(Object.fromEntries(group.filter((x) => x.id !== c.id).map((x) => [x.instagramAccountId, cfgFromCampaign(x)])));
        setName(c.name);
        setSelectedAccountId(c.instagramAccountId);
        setTriggerScope(
          c.matchAnyPost ? "any" : c.pendingNextReel ? "next" : "specific"
        );
        setPostId(c.postId);
        setPostUrl(c.postUrl);
        setMatchMode(c.matchAnyWord ? "any" : "specific");
        setKeywordText(c.keywords.join(", "));
        setDmTriggerEnabled(c.dmTriggerEnabled ?? false);
        setPublicReplyEnabled(c.publicReplyEnabled);
        setPublicReplyMessages(
          c.publicReplyMessages?.length
            ? c.publicReplyMessages
            : c.publicReplyMessage
              ? [c.publicReplyMessage]
              : [""]
        );
        setOpeningDmEnabled(c.openingDmEnabled);
        setOpeningDmMessage(c.openingDmMessage ?? "");
        setOpeningDmButtonLabel(c.openingDmButtonLabel ?? "");
        setDmMessage(c.dmMessage);
        setLinkButtonLabel(c.linkButtonLabel ?? "Open link");
        setIsActive(c.isActive);
        const link = c.trackedLinks?.[0]?.destinationUrl ?? "";
        setTrackedDestinationUrl(link);
        setLinkOpen(Boolean(link));
        const secondLink = c.trackedLinks?.[1];
        setSecondaryDestinationUrl(secondLink?.destinationUrl ?? "");
        setSecondaryButtonLabel(secondLink?.label ?? "Open link");
        setSecondLinkOpen(Boolean(secondLink?.destinationUrl));
        setRequireFollow(c.requireFollow ?? false);
        setFollowPromptMessage(c.followPromptMessage ?? "");
        setFollowPromptButtonLabel(
          c.followPromptButtonLabel ?? "i'm following"
        );
        setFollowUpEnabled(c.followUpEnabled ?? false);
        setFollowUpMessage(c.followUpMessage ?? "");
        setFollowUpDelayMinutes(c.followUpDelayMinutes ?? 0);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [mode, campaignId]);

  // Track which posts on the selected account are already assigned to an
  // automation, so the picker can highlight them. The campaign being edited is
  // excluded — its own post should read as selected, not "taken".
  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    fetch("/api/automations", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled || !payload.success) return;
        const map: Record<string, string> = {};
        for (const a of payload.data as LoadedCampaign[]) {
          if (!a.postId) continue;
          if (a.instagramAccountId !== selectedAccountId) continue;
          if (mode === "edit" && a.id === campaignId) continue;
          map[a.postId] = a.name;
        }
        setUsedPosts(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId, mode, campaignId]);

  // Prefill the editable fields from one queued import row. The reel is left
  // unset so the user picks it per row.
  function prefillFromRow(row: ImportRow) {
    setName(row.name ?? "");
    setTriggerScope("specific");
    setPostId(null);
    setPostUrl(null);
    setPostThumb(null);
    setPostCaption("");
    setMatchMode("specific");
    setKeywordText((row.keywords ?? []).join(", "));
    setDmMessage(row.dmMessage ?? "");
    setPublicReplyEnabled(Boolean(row.publicReply));
    setPublicReplyMessages(row.publicReply ? [row.publicReply] : [""]);
    const hasOpening = Boolean(row.openingDmMessage);
    setOpeningDmEnabled(hasOpening);
    setOpeningDmMessage(row.openingDmMessage ?? "");
    setOpeningDmButtonLabel(
      row.openingDmButtonLabel || (hasOpening ? "Send link" : "")
    );
    const link = row.trackedUrl ?? "";
    setTrackedDestinationUrl(link);
    setLinkOpen(Boolean(link));
    setError(null);
  }

  // Pick up a staged CSV import (new mode only) and prefill the first row.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (mode !== "new") return;
    try {
      const raw = window.localStorage.getItem(IMPORT_QUEUE_KEY);
      const acct = window.localStorage.getItem(IMPORT_ACCOUNT_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as ImportRow[];
      if (!Array.isArray(queue) || queue.length === 0) return;
      setImportQueue(queue);
      setImportTotal(queue.length);
      if (acct) setSelectedAccountId(acct);
      prefillFromRow(queue[0]);
    } catch {
      // ignore a malformed queue
    }
  }, [mode]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const username =
    accounts.find((a) => a.id === selectedAccountId)?.username ?? "yourbrand";

  const platformOfAccount = (id: string) => accounts.find((a) => a.id === id)?.platform ?? "INSTAGRAM";
  const activePlatform = platformOfAccount(selectedAccountId);
  const publicOnly = isPublicOnly(activePlatform);

  function snapshot(): NetCfg {
    return { triggerScope, postId, postUrl, postThumb, postCaption, dmTriggerEnabled, publicReplyEnabled, publicReplyMessages,
      openingDmEnabled, openingDmMessage, openingDmButtonLabel, dmMessage, linkOpen, trackedDestinationUrl, linkButtonLabel,
      secondLinkOpen, secondaryDestinationUrl, secondaryButtonLabel, requireFollow, followPromptMessage, followPromptButtonLabel,
      followUpEnabled, followUpMessage, followUpDelayMinutes };
  }
  function loadCfg(c: NetCfg) {
    setTriggerScope(c.triggerScope); setPostId(c.postId); setPostUrl(c.postUrl); setPostThumb(c.postThumb); setPostCaption(c.postCaption);
    setDmTriggerEnabled(c.dmTriggerEnabled); setPublicReplyEnabled(c.publicReplyEnabled); setPublicReplyMessages(c.publicReplyMessages);
    setOpeningDmEnabled(c.openingDmEnabled); setOpeningDmMessage(c.openingDmMessage); setOpeningDmButtonLabel(c.openingDmButtonLabel);
    setDmMessage(c.dmMessage); setLinkOpen(c.linkOpen); setTrackedDestinationUrl(c.trackedDestinationUrl); setLinkButtonLabel(c.linkButtonLabel);
    setSecondLinkOpen(c.secondLinkOpen); setSecondaryDestinationUrl(c.secondaryDestinationUrl); setSecondaryButtonLabel(c.secondaryButtonLabel);
    setRequireFollow(c.requireFollow); setFollowPromptMessage(c.followPromptMessage); setFollowPromptButtonLabel(c.followPromptButtonLabel);
    setFollowUpEnabled(c.followUpEnabled); setFollowUpMessage(c.followUpMessage); setFollowUpDelayMinutes(c.followUpDelayMinutes);
  }
  /* A network added to the campaign starts from what is on screen (same link,
     same texts) so you only change what is different. Threads/YouTube start
     with public replies on and three slots, since that is all they can do. */
  function startCfgFor(accountId: string): NetCfg {
    const base = { ...snapshot(), triggerScope: "any" as TriggerScope, postId: null, postUrl: null, postThumb: null, postCaption: "" };
    if (isPublicOnly(platformOfAccount(accountId))) {
      const replies = base.publicReplyMessages.filter((m) => m.trim());
      return { ...base, publicReplyEnabled: true, dmTriggerEnabled: false, openingDmEnabled: false, requireFollow: false, followUpEnabled: false,
        publicReplyMessages: [...replies, "", "", ""].slice(0, Math.max(3, replies.length)) };
    }
    return base;
  }
  function switchNetwork(accountId: string) {
    if (accountId === selectedAccountId) return;
    setNetCfgs((prev) => ({ ...prev, [selectedAccountId]: snapshot() }));
    loadCfg(netCfgs[accountId] ?? startCfgFor(accountId));
    setSelectedAccountId(accountId);
  }
  function toggleNetwork(accountId: string) {
    const order = netOrder.length ? netOrder : [selectedAccountId];
    if (order.includes(accountId)) {
      if (order.length === 1) return;
      const rest = order.filter((x) => x !== accountId);
      setNetOrder(rest);
      if (accountId === selectedAccountId) {
        const next = rest[0];
        loadCfg(netCfgs[next] ?? startCfgFor(next));
        setSelectedAccountId(next);
      }
      return;
    }
    setNetOrder([...order, accountId]);
    setNetCfgs((prev) => ({ ...prev, [selectedAccountId]: snapshot(), [accountId]: startCfgFor(accountId) }));
    loadCfg(startCfgFor(accountId));
    setSelectedAccountId(accountId);
  }

  function handlePostSelect(
    id: string,
    url?: string,
    thumb?: string,
    caption?: string
  ) {
    setPostId(id);
    setPostUrl(url ?? null);
    setPostThumb(thumb ?? null);
    setPostCaption(caption ?? "");
  }

  function ensureLinkToken() {
    setDmMessage((cur) => (cur.includes("{link}") ? cur : `${cur.trim()} {link}`.trim()));
  }

  async function handleSubmit(activeValue: boolean) {
    setError(null);

    if (!selectedAccountId) return setError("Connect an account first.");
    if (matchMode === "specific" && keywords.length === 0)
      return setError("Add at least one keyword, or switch to any word.");

    // Every network in the campaign, each with its own settings.
    const order = netOrder.length ? netOrder : [selectedAccountId];
    const cfgs: Record<string, NetCfg> = { ...netCfgs, [selectedAccountId]: snapshot() };
    for (const acc of order) {
      const c = cfgs[acc] ?? startCfgFor(acc);
      const net = PLATFORM_NAME[platformOfAccount(acc)] ?? "Instagram";
      const replies = new Set(c.publicReplyMessages.map((m) => m.trim().toLowerCase()).filter(Boolean));
      if (c.triggerScope === "specific" && !c.postId) return setError(`${net}: pick the post that triggers the campaign.`);
      if (isPublicOnly(platformOfAccount(acc))) {
        if (replies.size < 3) return setError(`${net}: add at least 3 different public replies — they rotate so it never looks like spam.`);
      } else {
        if (!c.dmMessage.trim()) return setError(`${net}: add the DM with the link.`);
        if (c.openingDmEnabled && (!c.openingDmMessage.trim() || !c.openingDmButtonLabel.trim()))
          return setError(`${net}: the opening DM needs a message and a button label.`);
      }
    }

    setSaving(true);
    const group = order.length > 1 ? groupId ?? `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}` : groupId;
    const shared = {
      name: name.trim() || `Campaign for @${username}`,
      matchAnyWord: matchMode === "any",
      keywords: matchMode === "any" ? [] : keywords,
      isActive: activeValue,
      groupId: group,
    };
    const payloadFor = (acc: string, c: NetCfg) => {
      const pub = isPublicOnly(platformOfAccount(acc));
      const replies = c.publicReplyMessages.map((m) => m.trim()).filter(Boolean);
      return {
        ...shared,
        instagramAccountId: acc,
        postId: c.triggerScope === "specific" ? c.postId : null,
        postUrl: c.triggerScope === "specific" ? c.postUrl : null,
        matchAnyPost: c.triggerScope === "any",
        pendingNextReel: c.triggerScope === "next",
        dmTriggerEnabled: pub ? false : c.dmTriggerEnabled,
        // Threads/YouTube never send a DM; the field is required, so it carries the first reply.
        dmMessage: pub ? replies[0] ?? "-" : c.dmMessage,
        openingDmEnabled: pub ? false : c.openingDmEnabled,
        openingDmMessage: !pub && c.openingDmEnabled ? c.openingDmMessage : null,
        openingDmButtonLabel: !pub && c.openingDmEnabled ? c.openingDmButtonLabel : null,
        publicReplyEnabled: pub ? true : c.publicReplyEnabled,
        publicReplyMessages: pub || c.publicReplyEnabled ? replies : [],
        trackedDestinationUrl: c.trackedDestinationUrl.trim() || "",
        linkButtonLabel: c.linkButtonLabel.trim() || "Open link",
        secondaryDestinationUrl: pub ? "" : c.secondaryDestinationUrl.trim() || "",
        secondaryButtonLabel: c.secondaryButtonLabel.trim() || "Open link",
        requireFollow: pub ? false : c.requireFollow,
        followPromptMessage: !pub && c.requireFollow ? c.followPromptMessage.trim() : "",
        followPromptButtonLabel: !pub && c.requireFollow ? c.followPromptButtonLabel.trim() || "i'm following" : "",
        followUpEnabled: pub ? false : c.followUpEnabled,
        followUpMessage: !pub && c.followUpEnabled ? c.followUpMessage.trim() : "",
        followUpDelayMinutes: !pub && c.followUpEnabled ? c.followUpDelayMinutes : 0,
      };
    };
    // Networks taken out of an existing campaign are paused, not deleted (their logs stay).
    const removed = Object.entries(netIds).filter(([acc]) => !order.includes(acc));
    const payload = payloadFor(selectedAccountId, cfgs[selectedAccountId]);

    try {
      // One request per network: PATCH the ones that already exist, POST the new ones.
      let data: { success: boolean; error?: string; details?: { fieldErrors?: Record<string, string[]> } } = { success: true };
      for (const acc of order) {
        const body = JSON.stringify(payloadFor(acc, cfgs[acc] ?? startCfgFor(acc)));
        const existing = netIds[acc] ?? (mode === "edit" && acc === selectedAccountId && !netOrder.length ? campaignId : undefined);
        const res = existing
          ? await fetch(`/api/automations?id=${existing}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
          : await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body });
        data = await res.json();
        if (!data.success) {
          data.error = `${PLATFORM_NAME[platformOfAccount(acc)] ?? ""}: ${data.error ?? "failed to save"}`;
          break;
        }
      }
      if (data.success) {
        for (const [, id] of removed) {
          await fetch(`/api/automations?id=${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: false, groupId: null }) });
        }
      }
      if (data.success) {
        // The post we just assigned is now in use. Reflect it immediately so
        // the picker flags it on the next imported row — the fetch that builds
        // this map doesn't re-run while the builder stays mounted through the
        // import queue.
        if (triggerScope === "specific" && postId) {
          const assignedPostId = postId;
          setUsedPosts((prev) => ({ ...prev, [assignedPostId]: payload.name }));
        }
        // Importing: advance to the next queued row instead of leaving.
        if (importQueue && importQueue.length > 1) {
          const remaining = importQueue.slice(1);
          try {
            window.localStorage.setItem(
              IMPORT_QUEUE_KEY,
              JSON.stringify(remaining)
            );
          } catch {
            // ignore
          }
          setImportQueue(remaining);
          prefillFromRow(remaining[0]);
          setSaving(false);
          if (typeof window !== "undefined") window.scrollTo({ top: 0 });
          return;
        }
        if (importQueue) {
          try {
            window.localStorage.removeItem(IMPORT_QUEUE_KEY);
            window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
          } catch {
            // ignore
          }
        }
        // refresh() busts the router cache so the list reflects the save
        // instead of landing on a stale (empty) campaigns page.
        router.push("/campaigns");
        router.refresh();
      } else {
        // Surface the specific field that failed validation instead of a
        // generic "Invalid input".
        const fieldErrors = data.details?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const firstField = fieldErrors && Object.keys(fieldErrors)[0];
        setError(
          firstField
            ? `${firstField}: ${fieldErrors[firstField][0]}`
            : data.error ?? "Failed to save campaign"
        );
        if (typeof window !== "undefined")
          window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch {
      setError("Failed to save campaign");
    } finally {
      setSaving(false);
    }
  }

  // Skip the current imported row without saving a campaign for it, advancing
  // to the next one (or finishing the import if it was the last).
  function skipRow() {
    if (!importQueue) return;
    setError(null);
    if (importQueue.length > 1) {
      const remaining = importQueue.slice(1);
      try {
        window.localStorage.setItem(IMPORT_QUEUE_KEY, JSON.stringify(remaining));
      } catch {
        // ignore
      }
      setImportQueue(remaining);
      prefillFromRow(remaining[0]);
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
      return;
    }
    // Last row skipped — finish the import.
    try {
      window.localStorage.removeItem(IMPORT_QUEUE_KEY);
      window.localStorage.removeItem(IMPORT_ACCOUNT_KEY);
    } catch {
      // ignore
    }
    router.push("/campaigns");
    router.refresh();
  }

  if (loading) {
    return <div className="panel h-64 rounded" />;
  }

  if (notFound) {
    return (
      <div className="panel rounded p-8 text-center">
        <p className="text-sm text-muted">Campaign not found.</p>
        <button
          onClick={() => router.push("/campaigns")}
          className="mt-4 rounded border border-border px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Back to campaigns
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {importQueue && (
        <div className="rounded border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-medium text-foreground">
            Importing {importTotal - importQueue.length + 1} of {importTotal}.
          </span>{" "}
          <span className="text-muted">
            Fields are prefilled from your CSV. Pick the reel, edit anything, and
            save to load the next one — or Skip if you don&rsquo;t want this one.
          </span>
        </div>
      )}

      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-center gap-3">
          {mode === "edit" ? (
            <>
              <span className="truncate text-sm font-semibold text-foreground">
                {name || "Untitled campaign"}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-semibold ${
                  isActive ? "bg-success/15 text-success" : "bg-zinc-500/15 text-muted"
                }`}
              >
                {isActive ? "LIVE" : "PAUSED"}
              </span>
            </>
          ) : (
            <span className="text-sm text-muted">New campaign</span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {importQueue && (
            <button
              type="button"
              onClick={skipRow}
              disabled={saving}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
            >
              {importQueue.length > 1 ? "Skip" : "Skip & finish"}
            </button>
          )}
          {mode === "edit" &&
            (isActive ? (
              <button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit(true)}
                disabled={saving}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
              >
                Go Live
              </button>
            ))}
          <button
            type="button"
            onClick={() => handleSubmit(mode === "new" ? true : isActive)}
            disabled={saving}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "new" ? "Go Live" : "Save changes"}
          </button>
        </div>
      </div>

      {/* min-w-0 on the cells: a grid item defaults to min-width:auto, so a
          long string widens the whole page instead of wrapping. */}
      <div className="grid gap-6 lg:grid-cols-[300px_1fr] lg:gap-8">
      {/* Left: controls */}
      <div className="space-y-8 min-w-0">
        {error && (
          <div className="rounded border border-error/20 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <label className="text-sm font-semibold text-foreground">
            Campaign name{" "}
            <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. YC referral"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
            maxLength={100}
          />
          {accounts.length > 0 && (
            <div className="pt-2 space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Networks in this campaign</span>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const order = netOrder.length ? netOrder : [selectedAccountId];
                  const inCampaign = order.includes(a.id);
                  const active = a.id === selectedAccountId;
                  return (
                    <div key={a.id} className={`flex items-center rounded-full border text-xs ${active ? "border-accent bg-accent/15 text-foreground" : inCampaign ? "border-accent/40 text-foreground" : "border-border text-muted"}`}>
                      <button type="button" className="px-3 py-1.5" onClick={() => (inCampaign ? switchNetwork(a.id) : toggleNetwork(a.id))}
                        title={inCampaign ? "Edit this network" : "Add this network to the campaign"}>
                        {accountLabel(a)}
                      </button>
                      {inCampaign && order.length > 1 && (
                        <button type="button" className="pr-2.5 text-muted hover:text-error" onClick={() => toggleNetwork(a.id)} aria-label="Remove network">×</button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted">
                Tap a network to add it. Each one keeps its own post, public replies and DMs — you are editing{" "}
                <strong className="text-foreground">{PLATFORM_NAME[activePlatform]}</strong>.
                {publicOnly && " Threads and YouTube have no DMs: here the campaign replies under the comment."}
              </p>
            </div>
          )}
        </div>

        <Section title="When someone comments on">
          <Radio
            checked={triggerScope === "specific"}
            onSelect={() => setTriggerScope("specific")}
          >
            a specific post or reel
          </Radio>
          {triggerScope === "specific" && (
            <div className="rounded-lg border border-border p-2">
              <PostPicker
                selectedPostId={postId}
                instagramAccountId={selectedAccountId}
                usedPostIds={usedPosts}
                onSelect={handlePostSelect}
              />
            </div>
          )}
          <Radio
            checked={triggerScope === "any"}
            onSelect={() => setTriggerScope("any")}
          >
            any post or reel
          </Radio>
          {activePlatform === "INSTAGRAM" && (
          <Radio
            checked={triggerScope === "next"}
            onSelect={() => setTriggerScope("next")}
          >
            next post or reel
          </Radio>
          )}
        </Section>

        <Section title="And this comment has">
          <Radio
            checked={matchMode === "specific"}
            onSelect={() => setMatchMode("specific")}
          >
            a specific word or words
          </Radio>
          {matchMode === "specific" && (
            <div className="space-y-1">
              <input
                value={keywordText}
                onChange={(e) => setKeywordText(e.target.value)}
                placeholder="Enter a word or multiple"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
              />
              <p className="text-xs text-muted">Use commas to separate words</p>
            </div>
          )}
          <Radio
            checked={matchMode === "any"}
            onSelect={() => setMatchMode("any")}
          >
            any word
          </Radio>
          {!publicOnly && (<>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              also reply when someone DMs{" "}
              {matchMode === "any" ? "anything" : "these words"}
            </span>
            <Toggle
              on={dmTriggerEnabled}
              onToggle={() => setDmTriggerEnabled(!dmTriggerEnabled)}
            />
          </div>
          {dmTriggerEnabled && (
            <p className="text-xs text-muted">
              {matchMode === "any"
                ? "Every DM to this account gets the reply below — use with care."
                : "A DM containing any of these words gets the same reply, no comment needed."}
            </p>
          )}
          </>)}
          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <span className="text-sm text-foreground">
              reply to their comments under the post
            </span>
            {publicOnly ? <span className="text-xs text-muted">always on here</span> : (
            <Toggle
              on={publicReplyEnabled}
              onToggle={() => setPublicReplyEnabled(!publicReplyEnabled)}
            />)}
          </div>
          {publicOnly && (
            <p className="text-xs text-muted">
              Write at least 3 different replies: they rotate, go out spread over a few minutes, at most{" "}
              {activePlatform === "YOUTUBE" ? "12 an hour / 80 a day" : "30 an hour / 200 a day"}, and each person gets one reply per day.
              That is what keeps {PLATFORM_NAME[activePlatform]} from treating it as spam. Use {"{link}"} to include your tracked link
              {activePlatform === "YOUTUBE" ? " (YouTube sometimes holds replies with links for review — a reply without the link that points to your bio is the safest)." : "."}
            </p>
          )}
          {(publicReplyEnabled || publicOnly) && (
            <div className="space-y-2">
              {publicReplyMessages.map((msg, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={msg}
                    onChange={(e) =>
                      setPublicReplyMessages((prev) =>
                        prev.map((m, idx) => (idx === i ? e.target.value : m))
                      )
                    }
                    placeholder="Sent you a DM! 📩"
                    maxLength={1000}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  />
                  {publicReplyMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPublicReplyMessages((prev) =>
                          prev.filter((_, idx) => idx !== i)
                        )
                      }
                      className="shrink-0 px-2 text-muted hover:text-error"
                      aria-label="Remove reply"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              {publicReplyMessages.length < 10 && (
                <button
                  type="button"
                  onClick={() =>
                    setPublicReplyMessages((prev) => [...prev, ""])
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  + Add another reply
                </button>
              )}
              <p className="text-xs text-muted">
                One is picked at random each time, so replies don&apos;t look
                identical.
              </p>
            </div>
          )}
        </Section>

        {!publicOnly && (<>
        <Section title="They will get">
          <div className="rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">an opening DM</span>
              <Toggle
                on={openingDmEnabled}
                onToggle={() => setOpeningDmEnabled(!openingDmEnabled)}
              />
            </div>
            {openingDmEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={openingDmMessage}
                  onChange={(e) => setOpeningDmMessage(e.target.value)}
                  placeholder="Hey there! I'm so happy you're here 😊"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={openingDmButtonLabel}
                  onChange={(e) => setOpeningDmButtonLabel(e.target.value)}
                  placeholder="Send me the link"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={64}
                />
              </div>
            )}
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                a follow requirement first
              </span>
              <Toggle
                on={requireFollow}
                onToggle={() => setRequireFollow(!requireFollow)}
              />
            </div>
            {requireFollow && activePlatform === "FACEBOOK" && (
              <p className="mt-2 text-xs text-warning">
                Facebook does not let apps check who follows a Page. They get the follow request and the button, and the link is sent when they tap it.
              </p>
            )}
            {requireFollow && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followPromptMessage}
                  onChange={(e) => setFollowPromptMessage(e.target.value)}
                  placeholder="quick favor before i send your link. i don't make any money from this, it's free. if you want to support me, just don't unfollow after, and star the repo on github if it helps you. tap the button once you're following and i'll send it over"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <input
                  value={followPromptButtonLabel}
                  onChange={(e) => setFollowPromptButtonLabel(e.target.value)}
                  placeholder="i'm following"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                  maxLength={20}
                />
                <p className="text-xs text-muted">
                  We send the link only after they tap the button and Instagram
                  confirms the follow. If it can&apos;t be verified, we send it
                  anyway.
                </p>
              </div>
            )}
          </div>
        </Section>

        <Section title="And then, they will get">
          <div className="rounded-lg border border-border p-3 space-y-2">
            <span className="text-sm text-foreground">a DM with a link</span>
            <textarea
              value={dmMessage}
              onChange={(e) => setDmMessage(e.target.value)}
              placeholder="Write a message"
              rows={3}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
              maxLength={1000}
            />
            {linkOpen ? (
              <div className="space-y-2">
                <input
                  value={trackedDestinationUrl}
                  onChange={(e) => setTrackedDestinationUrl(e.target.value)}
                  onBlur={ensureLinkToken}
                  placeholder="https://yourlink.com/offer"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                <input
                  value={linkButtonLabel}
                  onChange={(e) => setLinkButtonLabel(e.target.value)}
                  placeholder="Button label (e.g. Open link)"
                  maxLength={20}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                />
                {secondLinkOpen ? (
                  <div className="space-y-2 border-t border-border pt-2">
                    <input
                      value={secondaryDestinationUrl}
                      onChange={(e) => setSecondaryDestinationUrl(e.target.value)}
                      placeholder="https://yourlink.com/second"
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                    <input
                      value={secondaryButtonLabel}
                      onChange={(e) => setSecondaryButtonLabel(e.target.value)}
                      placeholder="Second button label"
                      maxLength={20}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setSecondLinkOpen(true)}
                    className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
                  >
                    + Add A Second Link
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                className="w-full rounded-lg border border-border py-2 text-sm text-muted hover:text-foreground"
              >
                + Add A Link
              </button>
            )}
            <p className="text-xs text-muted">
              {"{link}"} inserts the tracked link; {"{username}"} personalizes.
            </p>
          </div>
          <div className="mt-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                a follow-up thank-you message
              </span>
              <Toggle
                on={followUpEnabled}
                onToggle={() => setFollowUpEnabled(!followUpEnabled)}
              />
            </div>
            {followUpEnabled && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={followUpMessage}
                  onChange={(e) => setFollowUpMessage(e.target.value)}
                  placeholder="Btw just wanted to say thanks for following me, I appreciate the support 🙌"
                  rows={3}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none resize-none"
                  maxLength={1000}
                />
                <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
                  <span className="text-xs text-muted">Send it</span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={followUpDelayMinutes}
                    onChange={(e) =>
                      setFollowUpDelayMinutes(
                        Math.max(0, Math.min(1440, Math.floor(Number(e.target.value) || 0)))
                      )
                    }
                    className="w-20 rounded-lg border border-border bg-surface px-2 py-1 text-sm text-foreground focus:border-accent/40 focus:outline-none"
                  />
                  <span className="text-xs text-muted">
                    minutes after the link
                  </span>
                </div>
                <p className="text-xs text-muted">
                  {followUpDelayMinutes > 0
                    ? `Sent ${followUpDelayMinutes} min after they tap through.`
                    : "Sent right after they tap through."}
                  {" {username}"} personalizes it. Max 24 hours, to stay inside
                  Instagram&apos;s messaging window.
                </p>
              </div>
            )}
          </div>
        </Section>
        </>)}
      </div>

      {/* Right: preview */}
      <div>
        <p className="mb-4 text-sm text-muted">Preview</p>
        <div className="flex min-w-0 justify-center lg:sticky lg:top-6 lg:block">
          <CampaignPreview
            tab={previewTab}
            onTabChange={setPreviewTab}
            username={username}
            avatarUrl={avatarUrl}
            postThumb={postThumb}
            caption={postCaption}
            sampleComment={keywords[0] ?? ""}
            dmTriggerEnabled={dmTriggerEnabled}
            publicReplyEnabled={publicReplyEnabled}
            publicReplyMessage={publicReplyMessages.find((m) => m.trim()) ?? ""}
            openingDmEnabled={openingDmEnabled}
            openingDmMessage={openingDmMessage}
            openingDmButtonLabel={openingDmButtonLabel}
            revealMessage={dmMessage}
            hasLink={Boolean(trackedDestinationUrl.trim())}
            linkButtonLabel={linkButtonLabel || "Open link"}
            linkUrl={trackedDestinationUrl.trim() || undefined}
            hasSecondLink={
              secondLinkOpen && Boolean(secondaryDestinationUrl.trim())
            }
            secondLinkButtonLabel={secondaryButtonLabel || "Open link"}
            requireFollow={requireFollow}
            followPromptMessage={followPromptMessage}
            followPromptButtonLabel={followPromptButtonLabel || "i'm following"}
            followUpEnabled={followUpEnabled}
            followUpMessage={followUpMessage}
            followUpDelayMinutes={followUpDelayMinutes}
          />
        </div>
      </div>
      </div>
    </div>
  );
}
