import { describe, it, expect, vi, afterEach } from "vitest";
import { normalizePagePayload, parseCommentEvents } from "@/lib/meta/webhook";
import { anonymousCommenterId, isAnonymousCommenter } from "@/lib/social/ids";
import { getPlatformComments } from "@/lib/social/platforms";
import { matchKeywords, editDistance, matchCampaignComment, wordCount } from "@/lib/utils/keyword-matcher";

const MULTI = ["multiagente", "multiagentes", "multi agente", "multi agentes"];

describe("typo-tolerant keywords", () => {
  it("matches common typos of long keywords", () => {
    for (const text of ["Multiajentes", "mutliagente", "multiagnetes", "Multi-agentes!!", "multi agemtes", "multiagenteS 🙌", "quiero multiagentrs"]) {
      expect(matchKeywords(text, MULTI, true).matched, text).toBe(true);
    }
  });

  it("does not stretch short keywords or unrelated words", () => {
    expect(matchKeywords("gmail", ["email"], true).matched).toBe(false);
    expect(matchKeywords("ya", ["ia"], true).matched).toBe(false);
    expect(matchKeywords("me encanta el video", MULTI, true).matched).toBe(false);
    expect(matchKeywords("multimedia", MULTI, true).matched).toBe(false);
  });

  it("counts a swap of neighbouring letters as one typo", () => {
    expect(editDistance("mutliagente", "multiagente")).toBe(1);
    expect(editDistance("multiajentes", "multiagentes")).toBe(1);
  });
});

describe("unnamed Facebook commenters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("webhook: a comment without `from` still becomes an event, with a stand-in id", () => {
    const payload = {
      object: "page",
      entry: [{ id: "PAGE1", time: 1, changes: [{ field: "feed", value: {
        item: "comment", verb: "add", comment_id: "POST1_C9", post_id: "PAGE1_POST1", parent_id: "PAGE1_POST1", message: "Multiagentes" } }] }],
    };
    const events = parseCommentEvents(normalizePagePayload(payload) as Parameters<typeof parseCommentEvents>[0]);
    expect(events).toHaveLength(1);
    expect(events[0].commenterId).toBe("fb:anon-POST1_C9");
    expect(isAnonymousCommenter(events[0].commenterId)).toBe(true);
    expect(isAnonymousCommenter("fb:123")).toBe(false);
    expect(anonymousCommenterId("fb:POST1_C9")).toBe("fb:anon-POST1_C9");
  });

  it("sweep: pages through a viral post and keeps comments without `from`", async () => {
    const now = Date.now();
    const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();
    const page1 = { data: [
      { id: "P_1", message: "Multiagentes", created_time: iso(1) },
      { id: "P_2", message: "multiagente", created_time: iso(2), from: { id: "OTHERPAGE", name: "Barbería" } },
    ], paging: { next: "https://graph.facebook.com/next-page" } };
    const page2 = { data: [{ id: "P_3", message: "Multi agentes", created_time: iso(3) }], paging: { next: "https://graph.facebook.com/page-3" } };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(page1)))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })));
    vi.stubGlobal("fetch", fetchMock);

    const comments = await getPlatformComments("fb:PAGE1", "tok", "fb:PAGE1_POST1", now - 72 * 3600_000);

    expect(comments.map((c) => c.id)).toEqual(["fb:P_1", "fb:P_2", "fb:P_3"]);
    expect(comments[0].from?.id).toBe("fb:anon-P_1");
    expect(comments[1].from).toEqual({ id: "fb:OTHERPAGE", username: "Barbería" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sweep: stops paging once comments are older than the window", async () => {
    const now = Date.now();
    const old = new Date(now - 100 * 3600_000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "P_9", message: "Multiagentes", created_time: old }], paging: { next: "https://graph.facebook.com/more" } })));
    vi.stubGlobal("fetch", fetchMock);

    const comments = await getPlatformComments("fb:PAGE1", "tok", "fb:PAGE1_POST1", now - 72 * 3600_000);

    expect(comments).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("any-post campaigns only answer short comments", () => {
  const ia = { keywords: ["IA", "ia"], wholeWordMatch: true, matchAnyWord: false, matchAnyPost: true };
  const multi = { keywords: MULTI, wholeWordMatch: true, matchAnyWord: false, matchAnyPost: true };

  it("answers the call to action itself", () => {
    expect(matchCampaignComment("IA", ia).matched).toBe(true);
    expect(matchCampaignComment("Quiero la IA 🙏", ia).matched).toBe(true);
    expect(matchCampaignComment("MULTIAGENTES 🙌🙌", multi).matched).toBe(true);
    expect(matchCampaignComment("multiagentes por favor pásamelo", multi).matched).toBe(true);
  });

  it("ignores sentences that only mention the word", () => {
    expect(matchCampaignComment("Jajaja neta usan algo tan poderoso como la IA para hacer eso", ia).matched).toBe(false);
    expect(matchCampaignComment("se nota que es IA diseño básico estándar cientos de páginas iguales", ia).matched).toBe(false);
  });

  it("keeps the old behaviour for campaigns tied to one post", () => {
    const onePost = { ...ia, matchAnyPost: false };
    expect(matchCampaignComment("Jajaja neta usan algo tan poderoso como la IA para hacer eso", onePost).matched).toBe(true);
  });

  it("counts words without emojis or punctuation", () => {
    expect(wordCount("MULTIAGENTES 🙌🙌!!")).toBe(1);
    expect(wordCount("")).toBe(0);
  });
});
