import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.SESSION_SECRET ||= "test-session-secret";
process.env.LINKEDIN_CLIENT_ID ||= "test-client-id";
process.env.LINKEDIN_CLIENT_SECRET ||= "test-client-secret";

const { createApp, startServer } = await import("../src/app.js");
const { createLocalState } = await import("../src/local-state.js");

async function createTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "linkedin-mvp-"));
}

async function startTestServer({ stateDir, publishIntentTtlMs = 10 * 60 * 1000, appendHistoryEntry, linkedinOverrides } = {}) {
  const localDataDir = stateDir || path.join(await createTempDir(), ".local", "linkedin");
  const testConfig = {
    port: 3901,
    serverHost: "127.0.0.1",
    appBaseUrl: "http://localhost:3901",
    authUrl: "http://localhost:3901/auth/linkedin",
    sessionSecret: "test-session-secret",
    linkedinScopes: ["openid", "profile", "email", "w_member_social"],
    localDataDir,
    authFilePath: path.join(localDataDir, "auth.json"),
    draftsFilePath: path.join(localDataDir, "drafts.json"),
    draftsBackupFilePath: path.join(localDataDir, "drafts.backup.json"),
    syncDirPath: path.join(localDataDir, "sync"),
    syncPostsFilePath: path.join(localDataDir, "sync", "posts.json"),
    syncStateFilePath: path.join(localDataDir, "sync", "state.json"),
    publishHistoryFilePath: path.join(localDataDir, "publish-history.jsonl"),
    publishIntentTtlMs
  };
  const localState = createLocalState(testConfig);

  if (appendHistoryEntry) {
    localState.appendHistoryEntry = appendHistoryEntry;
  }

  const linkedin = {
    buildAuthorizationUrl: () => testConfig.authUrl,
    exchangeCodeForToken: async () => ({ access_token: "token" }),
    getUserInfo: async () => ({ sub: "user-1", name: "Test User" }),
    listAuthorPosts: async () => ({ elements: [] }),
    createPost: async () => ({ postId: "post-123", payload: { ok: true } }),
    createTextPost: async () => ({ postId: "post-123", payload: { ok: true } }),
    ...(linkedinOverrides || {})
  };

  const { app } = createApp({
    config: testConfig,
    linkedin,
    localState
  });

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    config: testConfig,
    localDataDir,
    localState,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
      await fs.rm(path.dirname(path.dirname(localDataDir)), { recursive: true, force: true });
    }
  };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createTestConfig(localDataDir, overrides = {}) {
  return {
    port: 3901,
    serverHost: "127.0.0.1",
    appBaseUrl: "http://localhost:3901",
    authUrl: "http://localhost:3901/auth/linkedin",
    sessionSecret: "test-session-secret",
    linkedinScopes: ["openid", "profile", "email", "w_member_social"],
    localDataDir,
    authFilePath: path.join(localDataDir, "auth.json"),
    draftsFilePath: path.join(localDataDir, "drafts.json"),
    draftsBackupFilePath: path.join(localDataDir, "drafts.backup.json"),
    syncDirPath: path.join(localDataDir, "sync"),
    syncPostsFilePath: path.join(localDataDir, "sync", "posts.json"),
    syncStateFilePath: path.join(localDataDir, "sync", "state.json"),
    publishHistoryFilePath: path.join(localDataDir, "publish-history.jsonl"),
    publishIntentTtlMs: 10 * 60 * 1000,
    ...overrides
  };
}

function createLinkedinStub(overrides = {}) {
  return {
    buildAuthorizationUrl: () => "http://localhost:3901/auth/linkedin",
    exchangeCodeForToken: async () => ({ access_token: "token" }),
    getUserInfo: async () => ({ sub: "user-1", name: "Test User" }),
    listAuthorPosts: async () => ({ elements: [] }),
    createPost: async () => ({ postId: "post-123", payload: { ok: true } }),
    createTextPost: async () => ({ postId: "post-123", payload: { ok: true } }),
    ...overrides
  };
}

async function writePersistedAuth(authFilePath) {
  await fs.mkdir(path.dirname(authFilePath), { recursive: true });
  await fs.writeFile(
    authFilePath,
    JSON.stringify(
      {
        accessToken: "persisted-token",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        scope: "openid profile w_member_social",
        personUrn: "urn:li:person:test-user",
        user: {
          sub: "test-user",
          name: "Persisted User"
        }
      },
      null,
      2
    )
  );
}

test("POST /posts rejects direct publish and does not call LinkedIn publish", async () => {
  let publishCalls = 0;
  const harness = await startTestServer({
    linkedinOverrides: {
      createTextPost: async () => {
        publishCalls += 1;
        return { postId: "should-not-run", payload: {} };
      }
    }
  });

  await writePersistedAuth(harness.config.authFilePath);

  try {
    const response = await fetch(`${harness.baseUrl}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Bypass attempt" })
    });
    const payload = await response.json();

    assert.equal(response.status, 409);
    assert.equal(payload.error, "direct_publish_disabled");
    assert.equal(publishCalls, 0);
  } finally {
    await harness.close();
  }
});

test("draft CRUD endpoints create, update, list, and delete persisted drafts", async () => {
  const harness = await startTestServer();

  try {
    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "  First draft body  " })
    });
    const createdDraft = await createResponse.json();

    const listAfterCreateResponse = await fetch(`${harness.baseUrl}/operator/drafts`);
    const listAfterCreate = await listAfterCreateResponse.json();

    const showResponse = await fetch(`${harness.baseUrl}/operator/drafts/${createdDraft.draftId}`);
    const shownDraft = await showResponse.json();

    const updateResponse = await fetch(`${harness.baseUrl}/operator/drafts/${createdDraft.draftId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Updated draft body" })
    });
    const updatedDraft = await updateResponse.json();

    const deleteResponse = await fetch(`${harness.baseUrl}/operator/drafts/${createdDraft.draftId}`, {
      method: "DELETE"
    });
    const deletePayload = await deleteResponse.json();

    const showAfterDeleteResponse = await fetch(`${harness.baseUrl}/operator/drafts/${createdDraft.draftId}`);
    const showAfterDelete = await showAfterDeleteResponse.json();

    const listAfterDeleteResponse = await fetch(`${harness.baseUrl}/operator/drafts`);
    const listAfterDelete = await listAfterDeleteResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(createdDraft.content, "First draft body");
    assert.equal(listAfterCreateResponse.status, 200);
    assert.equal(listAfterCreate.drafts.length, 1);
    assert.equal(listAfterCreate.drafts[0].draftId, createdDraft.draftId);
    assert.equal(showResponse.status, 200);
    assert.equal(shownDraft.draftId, createdDraft.draftId);
    assert.equal(updateResponse.status, 200);
    assert.equal(updatedDraft.draftId, createdDraft.draftId);
    assert.equal(updatedDraft.content, "Updated draft body");
    assert.equal(updatedDraft.createdAt, createdDraft.createdAt);
    assert.ok(updatedDraft.updatedAt >= createdDraft.updatedAt);
    assert.equal(deleteResponse.status, 200);
    assert.deepEqual(deletePayload, {
      deleted: true,
      draftId: createdDraft.draftId
    });
    assert.equal(showAfterDeleteResponse.status, 404);
    assert.equal(showAfterDelete.error, "draft_not_found");
    assert.equal(listAfterDeleteResponse.status, 200);
    assert.deepEqual(listAfterDelete.drafts, []);
  } finally {
    await harness.close();
  }
});

test("draft create and update persist rich post options", async () => {
  const harness = await startTestServer();

  try {
    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Texto com preview",
        postOptions: {
          article: {
            source: "https://pablostefan.com.br",
            title: "Portfolio",
            description: "Descricao curta"
          }
        }
      })
    });
    const createdDraft = await createResponse.json();

    const updateResponse = await fetch(`${harness.baseUrl}/operator/drafts/${createdDraft.draftId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Texto com imagem",
        postOptions: {
          image: {
            path: "./fixtures/cover.png",
            altText: "Capa do portfolio"
          }
        }
      })
    });
    const updatedDraft = await updateResponse.json();

    assert.equal(createResponse.status, 201);
    assert.deepEqual(createdDraft.postOptions, {
      article: {
        source: "https://pablostefan.com.br",
        title: "Portfolio",
        description: "Descricao curta",
        thumbnailPath: null
      }
    });
    assert.equal(updateResponse.status, 200);
    assert.deepEqual(updatedDraft.postOptions, {
      image: {
        path: "./fixtures/cover.png",
        altText: "Capa do portfolio"
      }
    });
  } finally {
    await harness.close();
  }
});

test("draft create accepts person mention metadata when the placeholder is present", async () => {
  const harness = await startTestServer();

  try {
    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Ola @{Mateus Pereira}, esse teste valida mention.",
        postOptions: {
          mentions: [
            {
              type: "person",
              name: "Mateus Pereira",
              urn: "urn:li:person:mateus123"
            }
          ]
        }
      })
    });
    const createdDraft = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.deepEqual(createdDraft.postOptions, {
      mentions: [
        {
          type: "person",
          name: "Mateus Pereira",
          urn: "urn:li:person:mateus123"
        }
      ]
    });
  } finally {
    await harness.close();
  }
});

test("draft create accepts member mention metadata when the placeholder is present", async () => {
  const harness = await startTestServer();

  try {
    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Ola @{Mateus Pereira}, esse teste valida member mention.",
        postOptions: {
          mentions: [
            {
              type: "person",
              name: "Mateus Pereira",
              urn: "urn:li:member:123456789"
            }
          ]
        }
      })
    });
    const createdDraft = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.deepEqual(createdDraft.postOptions, {
      mentions: [
        {
          type: "person",
          name: "Mateus Pereira",
          urn: "urn:li:member:123456789"
        }
      ]
    });
  } finally {
    await harness.close();
  }
});

test("draft create rejects mention metadata when the placeholder is missing", async () => {
  const harness = await startTestServer();

  try {
    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Ola Mateus Pereira, esse teste nao tem placeholder.",
        postOptions: {
          mentions: [
            {
              type: "person",
              name: "Mateus Pereira",
              urn: "urn:li:person:mateus123"
            }
          ]
        }
      })
    });
    const payload = await createResponse.json();

    assert.equal(createResponse.status, 400);
    assert.equal(payload.error, "mention_token_not_found");
  } finally {
    await harness.close();
  }
});

test("draft create returns duplicate metadata when the content already exists in synced posts", async () => {
  const harness = await startTestServer();

  try {
    await harness.localState.saveSyncPostsStore({
      version: 1,
      posts: [
        {
          postKey: "urn:li:activity:1",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:1/",
          text: "Post ja sincronizado no LinkedIn",
          publishedAt: "2026-04-01T12:00:00.000Z",
          publishedAtText: "2026-04-01"
        }
      ]
    });

    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Post ja sincronizado no LinkedIn" })
    });
    const payload = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(payload.warning, "Ja existe um post igual sincronizado no LinkedIn.");
    assert.equal(payload.duplicateCheck.status, "exact");
    assert.equal(payload.duplicateCheck.hasDuplicate, true);
    assert.equal(payload.duplicateCheck.hasSimilar, false);
    assert.equal(payload.duplicateCheck.match.postKey, "urn:li:activity:1");
    assert.equal(payload.duplicateCheck.match.matchType, "exact");
  } finally {
    await harness.close();
  }
});

test("draft create returns similar match candidates for close content", async () => {
  const harness = await startTestServer();

  try {
    await harness.localState.saveSyncPostsStore({
      version: 1,
      posts: [
        {
          postKey: "urn:li:activity:3",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:3/",
          text: "Flutter com foco no mercado enterprise e estabilidade para grandes aplicacoes corporativas.",
          publishedAt: "2026-04-01T12:00:00.000Z",
          publishedAtText: "2026-04-01"
        }
      ]
    });

    const createResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Flutter com foco no mercado enterprise e mais estabilidade para grandes aplicacoes." })
    });
    const payload = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(payload.warning, "Encontramos posts parecidos no historico sincronizado.");
    assert.equal(payload.duplicateCheck.status, "similar");
    assert.equal(payload.duplicateCheck.hasDuplicate, false);
    assert.equal(payload.duplicateCheck.hasSimilar, true);
    assert.equal(payload.duplicateCheck.similarMatches.length, 1);
    assert.equal(payload.duplicateCheck.similarMatches[0].postKey, "urn:li:activity:3");
    assert.equal(payload.duplicateCheck.similarMatches[0].matchType, "similar");
    assert.ok(payload.duplicateCheck.similarMatches[0].similarityScore >= 0.72);
  } finally {
    await harness.close();
  }
});

test("startServer binds on the configured localhost host and serves the bootstrap app", async () => {
  const workspaceDir = await createTempDir();
  const localDataDir = path.join(workspaceDir, ".local", "linkedin");
  const testConfig = createTestConfig(localDataDir, {
    port: 0,
    appBaseUrl: "http://localhost:0",
    authUrl: "http://localhost:0/auth/linkedin"
  });
  const localState = createLocalState(testConfig);
  const server = startServer({
    config: testConfig,
    localState,
    linkedin: createLinkedinStub({
      buildAuthorizationUrl: () => testConfig.authUrl
    })
  });

  try {
    await new Promise((resolve, reject) => {
      if (server.listening) {
        resolve();
        return;
      }

      server.once("listening", resolve);
      server.once("error", reject);
    });

    const address = server.address();

    assert.equal(typeof address?.port, "number");
    assert.equal(address?.address, "127.0.0.1");

    const healthResponse = await fetch(`http://127.0.0.1:${address.port}/health`);
    const healthPayload = await healthResponse.json();

    assert.equal(healthResponse.status, 200);
    assert.deepEqual(healthPayload, {
      ok: true,
      host: "127.0.0.1",
      port: 0
    });
  } finally {
    await closeServer(server);
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
});

test("publish confirm rejects invalid confirmation IDs and records the failure", async () => {
  const harness = await startTestServer();
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const response = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: "missing", confirm: true })
    });
    const payload = await response.json();
    const history = await fs.readFile(harness.config.publishHistoryFilePath, "utf8");

    assert.equal(response.status, 400);
    assert.equal(payload.error, "invalid_confirmation_id");
    assert.match(history, /invalid_confirmation_id/);
  } finally {
    await harness.close();
  }
});

test("publish prepare blocks duplicate content unless allowDuplicate is true", async () => {
  const harness = await startTestServer();
  await writePersistedAuth(harness.config.authFilePath);

  try {
    await harness.localState.saveSyncPostsStore({
      version: 1,
      posts: [
        {
          postKey: "urn:li:activity:2",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:2/",
          text: "Nao publique isso de novo",
          publishedAt: "2026-04-03T12:00:00.000Z",
          publishedAtText: "2026-04-03"
        }
      ]
    });

    const blockedResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Nao publique isso de novo" })
    });
    const blockedPayload = await blockedResponse.json();

    const allowedResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Nao publique isso de novo", allowDuplicate: true })
    });
    const allowedPayload = await allowedResponse.json();

    assert.equal(blockedResponse.status, 409);
    assert.equal(blockedPayload.error, "duplicate_post_detected");
    assert.equal(blockedPayload.duplicateCheck.hasDuplicate, true);
    assert.equal(allowedResponse.status, 201);
    assert.equal(allowedPayload.allowDuplicate, true);
    assert.equal(allowedPayload.duplicateCheck.hasDuplicate, true);
  } finally {
    await harness.close();
  }
});

test("publish prepare returns a warning when similar synced posts are found", async () => {
  const harness = await startTestServer();
  await writePersistedAuth(harness.config.authFilePath);

  try {
    await harness.localState.saveSyncPostsStore({
      version: 1,
      posts: [
        {
          postKey: "urn:li:activity:4",
          url: "https://www.linkedin.com/feed/update/urn:li:activity:4/",
          text: "Estou compartilhando uma vaga senior para trabalhar com C e .NET em Sao Paulo.",
          publishedAt: "2026-04-03T12:00:00.000Z",
          publishedAtText: "2026-04-03"
        }
      ]
    });

    const response = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Estou compartilhando uma vaga senior para trabalhar com C e .NET em Sao Paulo e modelo hibrido." })
    });
    const payload = await response.json();

    assert.equal(response.status, 201);
    assert.equal(payload.warning, "Encontramos posts parecidos no historico sincronizado. Revise antes de publicar.");
    assert.equal(payload.duplicateCheck.status, "similar");
    assert.equal(payload.duplicateCheck.hasDuplicate, false);
    assert.equal(payload.duplicateCheck.hasSimilar, true);
    assert.equal(payload.duplicateCheck.similarMatches[0].postKey, "urn:li:activity:4");
  } finally {
    await harness.close();
  }
});

test("publish confirm rejects expired confirmation IDs", async () => {
  const harness = await startTestServer({ publishIntentTtlMs: -1000 });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Expired publish" })
    });
    const prepared = await prepareResponse.json();
    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });
    const confirmed = await confirmResponse.json();

    assert.equal(prepareResponse.status, 201);
    assert.equal(confirmResponse.status, 410);
    assert.equal(confirmed.error, "expired_confirmation_id");
  } finally {
    await harness.close();
  }
});

test("publish confirm sends article metadata when draft includes preview fields", async () => {
  let publishPayload = null;
  const harness = await startTestServer({
    linkedinOverrides: {
      createPost: async (payload) => {
        publishPayload = payload;
        return { postId: "post-article", payload: { ok: true } };
      }
    }
  });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const draftResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Veja meu portfolio",
        postOptions: {
          article: {
            source: "https://pablostefan.com.br",
            title: "pablostefan.com.br",
            description: "Portfolio pessoal"
          }
        }
      })
    });
    const draft = await draftResponse.json();

    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ draftId: draft.draftId })
    });
    const prepared = await prepareResponse.json();

    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });

    assert.equal(confirmResponse.status, 201);
    assert.deepEqual(publishPayload.postOptions, {
      article: {
        source: "https://pablostefan.com.br",
        title: "pablostefan.com.br",
        description: "Portfolio pessoal",
        thumbnailPath: null
      }
    });
  } finally {
    await harness.close();
  }
});

test("publish prepare renders person mentions into little text before confirmation", async () => {
  let publishPayload = null;
  const harness = await startTestServer({
    linkedinOverrides: {
      createPost: async (payload) => {
        publishPayload = payload;
        return { postId: "post-mention", payload: { ok: true } };
      }
    }
  });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const draftResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Teste com @{Mateus Pereira} e link.",
        postOptions: {
          article: {
            source: "https://pablostefan.com.br",
            title: "Portfolio",
            description: "Descricao"
          },
          mentions: [
            {
              type: "person",
              name: "Mateus Pereira",
              urn: "urn:li:person:mateus123"
            }
          ]
        }
      })
    });
    const draft = await draftResponse.json();

    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ draftId: draft.draftId })
    });
    const prepared = await prepareResponse.json();

    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });

    assert.equal(prepareResponse.status, 201);
    assert.equal(prepared.content, "Teste com @[Mateus Pereira](urn:li:person:mateus123) e link.");
    assert.equal(confirmResponse.status, 201);
    assert.equal(publishPayload.content, "Teste com @[Mateus Pereira](urn:li:person:mateus123) e link.");
    assert.deepEqual(publishPayload.postOptions, {
      article: {
        source: "https://pablostefan.com.br",
        title: "Portfolio",
        description: "Descricao",
        thumbnailPath: null
      },
      mentions: [
        {
          type: "person",
          name: "Mateus Pereira",
          urn: "urn:li:person:mateus123"
        }
      ]
    });
  } finally {
    await harness.close();
  }
});

test("publish prepare renders member mentions into little text before confirmation", async () => {
  let publishPayload = null;
  const harness = await startTestServer({
    linkedinOverrides: {
      createPost: async (payload) => {
        publishPayload = payload;
        return { postId: "post-member-mention", payload: { ok: true } };
      }
    }
  });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const draftResponse = await fetch(`${harness.baseUrl}/operator/drafts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Teste com @{Mateus Pereira} e link.",
        postOptions: {
          article: {
            source: "https://pablostefan.com.br",
            title: "Portfolio",
            description: "Descricao"
          },
          mentions: [
            {
              type: "person",
              name: "Mateus Pereira",
              urn: "urn:li:member:123456789"
            }
          ]
        }
      })
    });
    const draft = await draftResponse.json();

    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ draftId: draft.draftId })
    });
    const prepared = await prepareResponse.json();

    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });

    assert.equal(prepareResponse.status, 201);
    assert.equal(prepared.content, "Teste com @[Mateus Pereira](urn:li:member:123456789) e link.");
    assert.equal(confirmResponse.status, 201);
    assert.equal(publishPayload.content, "Teste com @[Mateus Pereira](urn:li:member:123456789) e link.");
    assert.deepEqual(publishPayload.postOptions, {
      article: {
        source: "https://pablostefan.com.br",
        title: "Portfolio",
        description: "Descricao",
        thumbnailPath: null
      },
      mentions: [
        {
          type: "person",
          name: "Mateus Pereira",
          urn: "urn:li:member:123456789"
        }
      ]
    });
  } finally {
    await harness.close();
  }
});

test("publish prepare rejects invalid mixed rich post options", async () => {
  const harness = await startTestServer();
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const response = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: "Nao pode misturar",
        postOptions: {
          article: {
            source: "https://example.com",
            title: "Titulo",
            description: "Descricao"
          },
          image: {
            path: "./cover.png"
          }
        }
      })
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.error, "invalid_publish_post_options");
  } finally {
    await harness.close();
  }
});

test("LinkedIn 401 during publish invalidates persisted auth", async () => {
  const harness = await startTestServer({
    linkedinOverrides: {
      createPost: async () => {
        const error = new Error("Unauthorized");
        error.status = 401;
        throw error;
      }
    }
  });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Will fail auth" })
    });
    const prepared = await prepareResponse.json();
    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });
    const statusResponse = await fetch(`${harness.baseUrl}/operator/status`);
    const statusPayload = await statusResponse.json();

    assert.equal(confirmResponse.status, 401);
    assert.equal(statusPayload.state, "reauth_required");
    await assert.rejects(fs.access(harness.config.authFilePath));
  } finally {
    await harness.close();
  }
});

test("publish history persistence failures are surfaced after a successful publish", async () => {
  const harness = await startTestServer({
    appendHistoryEntry: async () => {
      throw new Error("disk full");
    }
  });
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const prepareResponse = await fetch(`${harness.baseUrl}/operator/publish/prepare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content: "Publish succeeds but history fails" })
    });
    const prepared = await prepareResponse.json();
    const confirmResponse = await fetch(`${harness.baseUrl}/operator/publish/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ confirmationId: prepared.confirmationId, confirm: true })
    });
    const confirmPayload = await confirmResponse.json();

    assert.equal(confirmResponse.status, 500);
    assert.equal(confirmPayload.error, "publish_history_persistence_failed");
    assert.equal(confirmPayload.published, true);
    assert.equal(confirmPayload.postId, "post-123");
  } finally {
    await harness.close();
  }
});

test("GET /me loads persisted auth without an existing session", async () => {
  const harness = await startTestServer();
  await writePersistedAuth(harness.config.authFilePath);

  try {
    const response = await fetch(`${harness.baseUrl}/me`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.personUrn, "urn:li:person:test-user");
    assert.equal(payload.profile.name, "Persisted User");
    assert.match(payload.tokenInfo.scope, /w_member_social/);
  } finally {
    await harness.close();
  }
});