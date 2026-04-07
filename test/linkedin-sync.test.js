import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SESSION_SECRET ||= "test-session-secret";
process.env.LINKEDIN_CLIENT_ID ||= "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET ||= "test-client-secret";

const { createLocalState } = await import("../src/local-state.js");
const {
  buildPostKey,
  getLinkedinSyncStatus,
  listLinkedinSyncPosts,
  mergeSyncPosts,
  normalizeMetricCount,
  resolveSyncRunOptions,
  selectPostsForEnrichment,
  normalizeVisibleText
} = await import("../src/linkedin-sync.js");

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "linkedin-sync-"));
}

function createTestConfig(localDataDir) {
  return {
    port: 3901,
    serverHost: "127.0.0.1",
    appBaseUrl: "http://localhost:3901",
    authUrl: "http://localhost:3901/auth/linkedin",
    sessionSecret: "test-session-secret",
    linkedinClientId: "test-client-id",
    linkedinClientSecret: "test-client-secret",
    linkedinRedirectUri: "http://localhost:3901/auth/linkedin/callback",
    linkedinApiVersion: "202504",
    linkedinScopes: ["openid", "profile", "email", "w_member_social"],
    linkedinSyncStartUrl: "https://www.linkedin.com/in/me/recent-activity/all/",
    localDataDir,
    authFilePath: path.join(localDataDir, "auth.json"),
    draftsFilePath: path.join(localDataDir, "drafts.json"),
    draftsBackupFilePath: path.join(localDataDir, "drafts.backup.json"),
    browserProfileDirPath: path.join(localDataDir, "browser-profile"),
    syncDirPath: path.join(localDataDir, "sync"),
    syncPostsFilePath: path.join(localDataDir, "sync", "posts.json"),
    syncStateFilePath: path.join(localDataDir, "sync", "state.json"),
    publishHistoryFilePath: path.join(localDataDir, "publish-history.jsonl"),
    publishIntentTtlMs: 10 * 60 * 1000
  };
}

test("normalizeMetricCount and normalizeVisibleText handle visible LinkedIn strings", () => {
  assert.equal(normalizeVisibleText("  Ola\n\u00a0mundo  "), "Ola mundo");
  assert.equal(normalizeMetricCount("1,2 mil reacoes"), 1200);
  assert.equal(normalizeMetricCount("3.4k comments"), 3400);
  assert.equal(normalizeMetricCount("18 reposts"), 18);
  assert.equal(normalizeMetricCount("sem numero"), null);
});

test("mergeSyncPosts normalizes relative LinkedIn timestamps into ISO dates", () => {
  const result = mergeSyncPosts([], [
    {
      urn: "urn:li:activity:10",
      text: "Post com data relativa",
      publishedAtText: "5 d • Editado •",
      metricText: "",
      hasImage: false,
      hasVideo: false,
      hasDocument: false,
      hasArticleLink: false
    }
  ], { seenAt: "2026-04-10T12:00:00.000Z" });

  assert.equal(result.posts[0].publishedAt, "2026-04-05T12:00:00.000Z");
  assert.equal(result.posts[0].publishedAtText, "5 d • Editado •");
});

test("mergeSyncPosts normalizes LinkedIn short month timestamps into ISO dates", () => {
  const result = mergeSyncPosts([], [
    {
      urn: "urn:li:activity:11",
      text: "Post com data mensal",
      publishedAtText: "2 m •",
      metricText: "",
      hasImage: false,
      hasVideo: false,
      hasDocument: false,
      hasArticleLink: false
    }
  ], { seenAt: "2026-04-07T12:00:00.000Z" });

  assert.equal(result.posts[0].publishedAt, "2026-02-07T12:00:00.000Z");
});

test("mergeSyncPosts parses LinkedIn permalink metric phrasing", () => {
  const result = mergeSyncPosts([], [
    {
      urn: "urn:li:activity:7445228080756973568",
      url: null,
      text: "Post com metricas",
      publishedAtText: "5 d • Editado •",
      metricText: "Rafaela Augusto e mais 14 pessoas reagiram 3 compartilhamentos Seja a primeira pessoa a comentar",
      hasImage: false,
      hasVideo: false,
      hasDocument: false,
      hasArticleLink: false
    }
  ], { seenAt: "2026-04-07T00:18:35.645Z" });

  assert.equal(result.posts[0].url, "https://www.linkedin.com/feed/update/urn:li:activity:7445228080756973568/");
  assert.equal(result.posts[0].metrics.reactions, 15);
  assert.equal(result.posts[0].metrics.reposts, 3);
  assert.equal(result.posts[0].metrics.comments, 0);
  assert.equal(
    result.posts[0].metrics.rawText,
    "Rafaela Augusto e mais 14 pessoas reagiram | 3 compartilhamentos | Seja a primeira pessoa a comentar"
  );
});

test("buildPostKey prefers stable activity identifiers over ephemeral ember ids", () => {
  assert.equal(
    buildPostKey({
      url: "https://www.linkedin.com/feed/update/urn:li:activity:7422674786868355072/?tracking=abc",
      urn: "ember265",
      text: "Teste",
      publishedAtText: "1 sem",
      type: "text"
    }),
    "urn:li:activity:7422674786868355072"
  );

  assert.match(
    buildPostKey({
      url: null,
      urn: "ember265",
      text: "Teste sem url",
      publishedAtText: "1 sem",
      type: "text"
    }),
    /^text:/
  );
});

test("resolveSyncRunOptions expands scan depth for full backfills", () => {
  assert.deepEqual(resolveSyncRunOptions(), {
    safeMaxScrolls: 6,
    enrichLimit: 5
  });

  assert.deepEqual(resolveSyncRunOptions({ fullScan: true }), {
    safeMaxScrolls: 60,
    enrichLimit: 0
  });

  assert.deepEqual(resolveSyncRunOptions({ fullScan: true, enrichAll: true }), {
    safeMaxScrolls: 60,
    enrichLimit: Number.POSITIVE_INFINITY
  });

  assert.deepEqual(resolveSyncRunOptions({ maxScrolls: 12, fullScan: true }), {
    safeMaxScrolls: 12,
    enrichLimit: 0
  });
});

test("selectPostsForEnrichment skips posts already seen in the current run", () => {
  const visiblePosts = [
    {
      urn: "urn:li:activity:1",
      text: "Primeiro post"
    },
    {
      urn: "urn:li:activity:2",
      text: "Segundo post"
    },
    {
      urn: "urn:li:activity:1",
      text: "Primeiro post duplicado"
    }
  ];

  assert.deepEqual(
    selectPostsForEnrichment(visiblePosts, new Set(["urn:li:activity:2"])).map((post) => post.urn),
    ["urn:li:activity:1"]
  );
});

test("mergeSyncPosts adds new posts and updates existing posts incrementally", () => {
  const firstSeenAt = "2026-04-06T10:00:00.000Z";
  const existingPosts = [
    {
      postKey: "urn:li:activity:1",
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
      urn: "urn:li:activity:1",
      text: "Post original",
      publishedAt: "2026-04-01T10:00:00.000Z",
      publishedAtText: "2026-04-01",
      type: "text",
      metrics: {
        rawText: "10 reactions",
        reactions: 10,
        comments: 1,
        reposts: 0
      },
      media: {
        hasImage: false,
        hasVideo: false,
        hasDocument: false,
        hasArticleLink: false
      },
      source: "linkedin_browser",
      firstSeenAt,
      lastSeenAt: firstSeenAt
    }
  ];
  const seenAt = "2026-04-06T11:00:00.000Z";
  const incomingPosts = [
    {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:1/?tracking=abc",
      text: "Post original atualizado",
      publishedAtText: "2026-04-01",
      metricText: "15 reactions 2 comments",
      hasImage: true,
      hasVideo: false,
      hasDocument: false,
      hasArticleLink: false
    },
    {
      url: "https://www.linkedin.com/feed/update/urn:li:activity:2/",
      text: "Novo post",
      publishedAt: "2026-04-05T09:00:00.000Z",
      publishedAtText: "2026-04-05",
      metricText: "2 comments",
      hasImage: false,
      hasVideo: true,
      hasDocument: false,
      hasArticleLink: false
    }
  ];

  const result = mergeSyncPosts(existingPosts, incomingPosts, { seenAt });
  const updatedExisting = result.posts.find((post) => post.postKey.includes("activity:1"));
  const newPost = result.posts.find((post) => post.postKey.includes("activity:2"));

  assert.equal(result.newCount, 1);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.posts.length, 2);
  assert.equal(updatedExisting.firstSeenAt, firstSeenAt);
  assert.equal(updatedExisting.lastSeenAt, seenAt);
  assert.equal(updatedExisting.text, "Post original atualizado");
  assert.equal(updatedExisting.media.hasImage, true);
  assert.equal(updatedExisting.metrics.reactions, 15);
  assert.equal(newPost.type, "video");
});

test("mergeSyncPosts removes ephemeral ember duplicates when a stable activity post exists", () => {
  const result = mergeSyncPosts(
    [
      {
        postKey: "ember263",
        urn: "ember263",
        url: null,
        text: "Texto duplicado",
        publishedAt: null,
        publishedAtText: null,
        type: "text",
        metrics: { rawText: null, reactions: null, comments: null, reposts: null },
        media: { hasImage: false, hasVideo: false, hasDocument: false, hasArticleLink: false },
        source: "linkedin_browser",
        firstSeenAt: "2026-04-06T10:00:00.000Z",
        lastSeenAt: "2026-04-06T10:00:00.000Z"
      },
      {
        postKey: "urn:li:activity:123",
        urn: "urn:li:activity:123",
        url: null,
        text: "Texto duplicado",
        publishedAt: null,
        publishedAtText: null,
        type: "text",
        metrics: { rawText: null, reactions: null, comments: null, reposts: null },
        media: { hasImage: false, hasVideo: false, hasDocument: false, hasArticleLink: false },
        source: "linkedin_browser",
        firstSeenAt: "2026-04-06T11:00:00.000Z",
        lastSeenAt: "2026-04-06T11:00:00.000Z"
      }
    ],
    [],
    { seenAt: "2026-04-06T12:00:00.000Z" }
  );

  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].postKey, "urn:li:activity:123");
  assert.equal(result.posts[0].firstSeenAt, "2026-04-06T10:00:00.000Z");
  assert.equal(result.posts[0].lastSeenAt, "2026-04-06T11:00:00.000Z");
});

test("mergeSyncPosts sorts posts by published date from newest to oldest", () => {
  const result = mergeSyncPosts([], [
    {
      urn: "urn:li:activity:21",
      text: "Post mais antigo",
      publishedAt: "2026-01-01T10:00:00.000Z",
      metricText: ""
    },
    {
      urn: "urn:li:activity:22",
      text: "Post mais novo",
      publishedAt: "2026-03-01T10:00:00.000Z",
      metricText: ""
    },
    {
      urn: "urn:li:activity:23",
      text: "Post sem data",
      metricText: ""
    }
  ], { seenAt: "2026-04-07T12:00:00.000Z" });

  assert.deepEqual(result.posts.map((post) => post.urn), [
    "urn:li:activity:22",
    "urn:li:activity:21",
    "urn:li:activity:23"
  ]);
});

test("sync state and posts are persisted separately from publish history", async () => {
  const workspaceDir = await createTempDir();
  const localDataDir = path.join(workspaceDir, ".local", "linkedin");
  const appConfig = createTestConfig(localDataDir);
  const localState = createLocalState(appConfig);

  try {
    await localState.saveSyncPostsStore({
      posts: [
        {
          postKey: "post-1",
          text: "Sincronizado",
          type: "text",
          metrics: { rawText: null, reactions: null, comments: null, reposts: null },
          media: { hasImage: false, hasVideo: false, hasDocument: false, hasArticleLink: false }
        }
      ]
    });
    await localState.saveSyncState({
      lastRunAt: "2026-04-06T12:00:00.000Z",
      lastSuccessfulRunAt: "2026-04-06T12:00:01.000Z",
      lastStartUrl: appConfig.linkedinSyncStartUrl,
      lastStopReason: "reached_known_post",
      lastError: null,
      knownPostKeys: ["post-1"],
      totalPosts: 1
    });
    await fs.mkdir(appConfig.browserProfileDirPath, { recursive: true });

    const status = await getLinkedinSyncStatus({ appConfig, localState });
    const postsStore = await localState.loadSyncPostsStore();
    const syncState = await localState.loadSyncState();

    assert.equal(status.browserProfilePresent, true);
    assert.equal(status.totalStoredPosts, 1);
    assert.equal(syncState.lastStopReason, "reached_known_post");
    assert.deepEqual(syncState.knownPostKeys, ["post-1"]);
    assert.equal(postsStore.posts[0].text, "Sincronizado");

    await assert.rejects(fs.readFile(appConfig.publishHistoryFilePath, "utf8"), {
      code: "ENOENT"
    });
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test("listLinkedinSyncPosts supports limit and query filters", async () => {
  const workspaceDir = await createTempDir();
  const localDataDir = path.join(workspaceDir, ".local", "linkedin");
  const appConfig = createTestConfig(localDataDir);
  const localState = createLocalState(appConfig);

  try {
    await localState.saveSyncPostsStore({
      posts: [
        {
          postKey: "urn:li:activity:1",
          urn: "urn:li:activity:1",
          url: null,
          text: "Primeiro post sobre XP",
          publishedAt: null,
          publishedAtText: "1 d",
          type: "text",
          metrics: { rawText: null, reactions: null, comments: null, reposts: null },
          media: { hasImage: false, hasVideo: false, hasDocument: false, hasArticleLink: false }
        },
        {
          postKey: "urn:li:activity:2",
          urn: "urn:li:activity:2",
          url: null,
          text: "Segundo post sobre trading",
          publishedAt: null,
          publishedAtText: "2 d",
          type: "text",
          metrics: { rawText: null, reactions: null, comments: null, reposts: null },
          media: { hasImage: false, hasVideo: false, hasDocument: false, hasArticleLink: false }
        }
      ]
    });

    const filteredResult = await listLinkedinSyncPosts({
      appConfig,
      localState,
      limit: 1,
      query: "trading"
    });

    assert.equal(filteredResult.totalStoredPosts, 2);
    assert.equal(filteredResult.returnedPosts, 1);
    assert.equal(filteredResult.posts[0].postKey, "urn:li:activity:2");
    assert.equal(filteredResult.posts[0].excerpt, "Segundo post sobre trading");
    assert.equal(filteredResult.posts[0].metrics.rawText, undefined);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});