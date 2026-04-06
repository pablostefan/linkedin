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

test("LinkedIn 401 during publish invalidates persisted auth", async () => {
  const harness = await startTestServer({
    linkedinOverrides: {
      createTextPost: async () => {
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