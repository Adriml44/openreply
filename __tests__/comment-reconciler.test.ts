import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, mockQueueAdd, mockGetPlatformMedia, mockGetPlatformComments, mockGetUserMedia, mockGetRecentMediaComments } =
  vi.hoisted(() => ({
    mockPrisma: {
      automation: { findMany: vi.fn() },
      dmLog: { findMany: vi.fn() },
      operationalEvent: { create: vi.fn() },
    },
    mockQueueAdd: vi.fn(),
    mockGetPlatformMedia: vi.fn(),
    mockGetPlatformComments: vi.fn(),
    mockGetUserMedia: vi.fn(),
    mockGetRecentMediaComments: vi.fn(),
  }));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => ({ add: mockQueueAdd }) }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain-${t}` }));
vi.mock("@/lib/meta/client", () => ({
  getUserMedia: mockGetUserMedia,
  getRecentMediaComments: mockGetRecentMediaComments,
  MetaApiError: class MetaApiError extends Error {
    code = 0;
  },
}));
vi.mock("@/lib/social/platforms", () => ({
  getPlatformMedia: mockGetPlatformMedia,
  getPlatformComments: mockGetPlatformComments,
}));

import { reconcileComments } from "@/lib/polling/comment-reconciler";

const ytAccount = { id: "acc-yt", instagramId: "yt:CHANNEL", username: "@canal", accessToken: "tok" };

function campaign(id: string, keyword: string) {
  return {
    id,
    name: keyword.toUpperCase(),
    postId: null,
    matchAnyPost: true,
    matchAnyWord: false,
    keywords: [keyword],
    wholeWordMatch: true,
    publicReplyEnabled: true,
    workspaceId: "ws",
    instagramAccount: ytAccount,
  };
}

const now = new Date().toISOString();

describe("reconcileComments shared reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.dmLog.findMany.mockResolvedValue([]);
    mockPrisma.operationalEvent.create.mockResolvedValue({});
    mockQueueAdd.mockResolvedValue({});
    mockGetPlatformMedia.mockResolvedValue([{ id: "yt:v1" }, { id: "yt:v2" }]);
    mockGetPlatformComments.mockImplementation(async (_acc: string, _tok: string, mediaId: string) =>
      mediaId === "yt:v1"
        ? [
            { id: "yt:c1", text: "multiagente", timestamp: now, from: { id: "yt:u1", username: "uno" }, replies: { data: [] } },
            { id: "yt:c2", text: "sistema", timestamp: now, from: { id: "yt:u2", username: "dos" }, replies: { data: [] } },
          ]
        : []
    );
  });

  it("reads an account's videos and comments once per sweep, for all its campaigns", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      campaign("a1", "multiagente"),
      campaign("a2", "sistema"),
      campaign("a3", "email"),
    ]);

    await reconcileComments();

    expect(mockGetPlatformMedia).toHaveBeenCalledTimes(1);
    expect(mockGetPlatformComments).toHaveBeenCalledTimes(2); // one per video, not per campaign
    // Each campaign still gets its own matches.
    const enqueued = mockQueueAdd.mock.calls.map((c) => c[1].commentId).sort();
    expect(enqueued).toEqual(["yt:c1", "yt:c2"]);
  });

  it("shares a failed read instead of retrying it for every campaign", async () => {
    mockGetPlatformMedia.mockRejectedValue(new Error("quota exceeded"));
    mockPrisma.automation.findMany.mockResolvedValue([campaign("a1", "multiagente"), campaign("a2", "sistema")]);

    await reconcileComments();

    expect(mockGetPlatformMedia).toHaveBeenCalledTimes(1);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledTimes(2);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});
