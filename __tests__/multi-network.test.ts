import { describe, it, expect } from "vitest";
import { normalizePagePayload, parseCommentEvents, parsePostbackEvents } from "@/lib/meta/webhook";
import { platformOf, rawId, withPrefix, supportsDm } from "@/lib/social/ids";

describe("multi-network ids", () => {
  it("routes by prefix and strips it for the API", () => {
    expect(platformOf("17841400000000000")).toBe("INSTAGRAM");
    expect(platformOf("fb:123_456")).toBe("FACEBOOK");
    expect(platformOf("th:999")).toBe("THREADS");
    expect(platformOf("yt:UgzAbc")).toBe("YOUTUBE");
    expect(rawId("fb:123_456")).toBe("123_456");
    expect(withPrefix("YOUTUBE", "UgzAbc")).toBe("yt:UgzAbc");
    expect(withPrefix("YOUTUBE", "yt:UgzAbc")).toBe("yt:UgzAbc");
    expect(supportsDm("FACEBOOK")).toBe(true);
    expect(supportsDm("THREADS")).toBe(false);
  });
});

describe("Facebook Page webhooks", () => {
  const comment = (over: Record<string, unknown> = {}) => ({
    object: "page",
    entry: [{ id: "PAGE1", time: 1, changes: [{ field: "feed", value: {
      item: "comment", verb: "add", comment_id: "POST1_C1", post_id: "PAGE1_POST1", parent_id: "PAGE1_POST1",
      message: "LINK please", from: { id: "USER1", name: "Ana" }, ...over } }] }],
  });

  it("turns a new top-level comment into an Instagram-shaped comment event", () => {
    const events = parseCommentEvents(normalizePagePayload(comment()) as Parameters<typeof parseCommentEvents>[0]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      instagramAccountId: "fb:PAGE1", commentId: "fb:POST1_C1", commenterId: "fb:USER1",
      commenterName: "Ana", mediaId: "fb:PAGE1_POST1", commentText: "LINK please",
    });
  });

  it("ignores replies to comments and the page's own comments", () => {
    const reply = parseCommentEvents(normalizePagePayload(comment({ parent_id: "POST1_C0" })) as Parameters<typeof parseCommentEvents>[0]);
    const own = parseCommentEvents(normalizePagePayload(comment({ from: { id: "PAGE1", name: "Me" } })) as Parameters<typeof parseCommentEvents>[0]);
    expect(reply).toHaveLength(0);
    expect(own).toHaveLength(0);
  });

  it("keeps Messenger postbacks (follow-gate button) with prefixed ids", () => {
    const events = parsePostbackEvents(normalizePagePayload({
      object: "page",
      entry: [{ id: "PAGE1", time: 1, messaging: [{ sender: { id: "USER1" }, recipient: { id: "PAGE1" },
        postback: { mid: "m1", title: "Ya te sigo", payload: "follow:auto1" } }] }],
    }) as Parameters<typeof parsePostbackEvents>[0]);
    expect(events[0]).toMatchObject({ instagramAccountId: "fb:PAGE1", userId: "fb:USER1", payload: "follow:auto1" });
  });

  it("leaves Instagram payloads untouched", () => {
    const ig = { object: "instagram", entry: [] };
    expect(normalizePagePayload(ig)).toBe(ig);
  });
});
