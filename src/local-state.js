import crypto from "node:crypto";
import fs from "node:fs/promises";

const DRAFT_STORE_VERSION = 1;
const SYNC_STORE_VERSION = 1;

export class DraftStoreCorruptedError extends Error {
  constructor(filePath, backupPath, cause) {
    super(
      [
        `Draft store is corrupted at ${filePath}.`,
        backupPath ? `Last known good backup: ${backupPath}.` : "No draft backup is available."
      ].join(" ")
    );
    this.name = "DraftStoreCorruptedError";
    this.code = "drafts_file_corrupted";
    this.filePath = filePath;
    this.backupPath = backupPath;
    this.cause = cause;
  }
}

export class SyncStoreCorruptedError extends Error {
  constructor(filePath, cause) {
    super(`LinkedIn sync store is corrupted at ${filePath}.`);
    this.name = "SyncStoreCorruptedError";
    this.code = "sync_store_corrupted";
    this.filePath = filePath;
    this.cause = cause;
  }
}

function sortDraftsByUpdatedAt(drafts) {
  return drafts.sort((left, right) => {
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

async function readUtf8File(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function createLocalState(appConfig) {
  const intents = new Map();

  async function ensureLocalDataDir() {
    await fs.mkdir(appConfig.localDataDir, { recursive: true });
  }

  async function writeJsonFile(filePath, payload) {
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  async function writeJsonFileAtomically(filePath, payload) {
    const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;
    const tempFilePath = `${filePath}.${crypto.randomUUID()}.tmp`;

    await fs.writeFile(tempFilePath, serializedPayload, "utf8");
    await fs.rename(tempFilePath, filePath);
  }

  async function ensureSyncDir() {
    await fs.mkdir(appConfig.syncDirPath, { recursive: true });
  }

  function buildReauthState(reason, message) {
    return {
      authenticated: false,
      state: "reauth_required",
      reason,
      reauthUrl: appConfig.authUrl,
      message
    };
  }

  function normalizeUserSummary(user = {}) {
    const derivedName = [user.given_name, user.family_name].filter(Boolean).join(" ").trim();

    return {
      sub: user.sub,
      name: user.name || derivedName || user.email || user.sub
    };
  }

  async function loadPersistedAuth() {
    await ensureLocalDataDir();

    const raw = await readUtf8File(appConfig.authFilePath);

    if (!raw) {
      return buildReauthState(
        "not_authenticated",
        "Open the browser login URL to connect LinkedIn before using operator actions."
      );
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      await invalidatePersistedAuth({ reason: "invalid_auth_file" });

      return buildReauthState(
        "invalid_auth_file",
        "Persisted auth could not be read. Authenticate again to recreate the local auth file."
      );
    }

    if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
      await invalidatePersistedAuth({ reason: "expired" });

      return buildReauthState(
        "expired",
        "Persisted auth expired. Open the browser login URL to refresh access."
      );
    }

    return {
      authenticated: true,
      state: "authenticated",
      reauthUrl: appConfig.authUrl,
      auth: {
        accessToken: parsed.accessToken,
        expiresAt: parsed.expiresAt || null,
        scope: parsed.scope || "",
        personUrn: parsed.personUrn,
        user: normalizeUserSummary(parsed.user)
      }
    };
  }

  async function savePersistedAuth({ accessToken, expiresAt, scope, personUrn, user }) {
    await ensureLocalDataDir();

    const persistedAuth = {
      accessToken,
      expiresAt: expiresAt || null,
      scope: scope || "",
      personUrn,
      user: normalizeUserSummary(user)
    };

    await writeJsonFile(appConfig.authFilePath, persistedAuth);

    return persistedAuth;
  }

  async function invalidatePersistedAuth() {
    await ensureLocalDataDir();
    await fs.rm(appConfig.authFilePath, { force: true });
  }

  async function loadDraftStore() {
    await ensureLocalDataDir();

    const raw = await readUtf8File(appConfig.draftsFilePath);

    if (!raw) {
      return {
        version: DRAFT_STORE_VERSION,
        drafts: {}
      };
    }

    try {
      const parsed = JSON.parse(raw);

      return {
        version: parsed.version || DRAFT_STORE_VERSION,
        drafts: parsed.drafts || {}
      };
    } catch (error) {
      throw new DraftStoreCorruptedError(
        appConfig.draftsFilePath,
        appConfig.draftsBackupFilePath,
        error
      );
    }
  }

  async function writeDraftStoreAtomically(store) {
    await ensureLocalDataDir();

    await writeJsonFileAtomically(appConfig.draftsFilePath, store);
    await writeJsonFile(appConfig.draftsBackupFilePath, store);
  }

  async function loadSyncPostsStore() {
    await ensureSyncDir();

    const raw = await readUtf8File(appConfig.syncPostsFilePath);

    if (!raw) {
      return {
        version: SYNC_STORE_VERSION,
        posts: []
      };
    }

    try {
      const parsed = JSON.parse(raw);

      return {
        version: parsed.version || SYNC_STORE_VERSION,
        posts: Array.isArray(parsed.posts) ? parsed.posts : []
      };
    } catch (error) {
      throw new SyncStoreCorruptedError(appConfig.syncPostsFilePath, error);
    }
  }

  async function loadSyncState() {
    await ensureSyncDir();

    const raw = await readUtf8File(appConfig.syncStateFilePath);

    if (!raw) {
      return {
        version: SYNC_STORE_VERSION,
        lastRunAt: null,
        lastSuccessfulRunAt: null,
        lastStartUrl: appConfig.linkedinSyncStartUrl,
        lastStopReason: null,
        lastError: null,
        knownPostKeys: [],
        totalPosts: 0
      };
    }

    try {
      const parsed = JSON.parse(raw);

      return {
        version: parsed.version || SYNC_STORE_VERSION,
        lastRunAt: parsed.lastRunAt || null,
        lastSuccessfulRunAt: parsed.lastSuccessfulRunAt || null,
        lastStartUrl: parsed.lastStartUrl || appConfig.linkedinSyncStartUrl,
        lastStopReason: parsed.lastStopReason || null,
        lastError: parsed.lastError || null,
        knownPostKeys: Array.isArray(parsed.knownPostKeys) ? parsed.knownPostKeys : [],
        totalPosts: Number.isFinite(Number(parsed.totalPosts)) ? Number(parsed.totalPosts) : 0
      };
    } catch (error) {
      throw new SyncStoreCorruptedError(appConfig.syncStateFilePath, error);
    }
  }

  async function saveSyncPostsStore(store) {
    await ensureSyncDir();
    await writeJsonFileAtomically(appConfig.syncPostsFilePath, {
      version: SYNC_STORE_VERSION,
      posts: Array.isArray(store?.posts) ? store.posts : []
    });
  }

  async function saveSyncState(state) {
    await ensureSyncDir();
    await writeJsonFileAtomically(appConfig.syncStateFilePath, {
      version: SYNC_STORE_VERSION,
      lastRunAt: state?.lastRunAt || null,
      lastSuccessfulRunAt: state?.lastSuccessfulRunAt || null,
      lastStartUrl: state?.lastStartUrl || appConfig.linkedinSyncStartUrl,
      lastStopReason: state?.lastStopReason || null,
      lastError: state?.lastError || null,
      knownPostKeys: Array.isArray(state?.knownPostKeys) ? state.knownPostKeys : [],
      totalPosts: Number.isFinite(Number(state?.totalPosts)) ? Number(state.totalPosts) : 0
    });
  }

  async function listDrafts() {
    const store = await loadDraftStore();
    return sortDraftsByUpdatedAt(Object.values(store.drafts));
  }

  async function getDraft(draftId) {
    const store = await loadDraftStore();
    return store.drafts[draftId] || null;
  }

  async function saveDraft({ draftId, content }) {
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (!normalizedContent) {
      const error = new Error("Draft content must be a non-empty string.");
      error.code = "invalid_draft_content";
      throw error;
    }

    const store = await loadDraftStore();
    const existingDraft = draftId ? store.drafts[draftId] : null;
    const now = new Date().toISOString();
    const nextDraftId = existingDraft?.draftId || draftId || crypto.randomUUID();

    const nextDraft = {
      draftId: nextDraftId,
      content: normalizedContent,
      createdAt: existingDraft?.createdAt || now,
      updatedAt: now
    };

    store.version = DRAFT_STORE_VERSION;
    store.drafts[nextDraftId] = nextDraft;
    await writeDraftStoreAtomically(store);

    return nextDraft;
  }

  async function deleteDraft(draftId) {
    const store = await loadDraftStore();

    if (!store.drafts[draftId]) {
      return false;
    }

    delete store.drafts[draftId];
    await writeDraftStoreAtomically(store);

    return true;
  }

  async function appendHistoryEntry(entry) {
    await ensureLocalDataDir();
    await fs.appendFile(appConfig.publishHistoryFilePath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async function listHistory({ limit = 20 } = {}) {
    await ensureLocalDataDir();

    const raw = await readUtf8File(appConfig.publishHistoryFilePath);

    if (!raw) {
      return [];
    }

    const lines = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const entries = lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        const parseError = new Error(`Publish history is corrupted at line ${index + 1}.`);
        parseError.code = "publish_history_corrupted";
        throw parseError;
      }
    });

    return entries.slice(-limit).reverse();
  }

  function purgeExpiredIntents(now = Date.now()) {
    for (const [confirmationId, intent] of intents.entries()) {
      if (Date.parse(intent.expiresAt) <= now) {
        intents.delete(confirmationId);
      }
    }
  }

  function createPublishIntent({ draftId = null, content }) {
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (!normalizedContent) {
      const error = new Error("Publish content must be a non-empty string.");
      error.code = "invalid_publish_content";
      throw error;
    }

    const now = Date.now();
    const confirmationId = crypto.randomUUID();
    const intent = {
      confirmationId,
      draftId,
      content: normalizedContent,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + appConfig.publishIntentTtlMs).toISOString(),
      consumedAt: null
    };

    purgeExpiredIntents(now);
    intents.set(confirmationId, intent);

    return {
      confirmationId: intent.confirmationId,
      draftId: intent.draftId,
      content: intent.content,
      expiresAt: intent.expiresAt
    };
  }

  function consumePublishIntent(confirmationId) {
    const now = Date.now();

    const intent = intents.get(confirmationId);

    if (!intent) {
      purgeExpiredIntents(now);

      return {
        ok: false,
        code: "invalid_confirmation_id",
        status: 400,
        message: "Confirmation ID is invalid or already consumed."
      };
    }

    if (Date.parse(intent.expiresAt) <= now) {
      intents.delete(confirmationId);
      purgeExpiredIntents(now);

      return {
        ok: false,
        code: "expired_confirmation_id",
        status: 410,
        message: "Confirmation ID expired. Prepare the publish again."
      };
    }

    if (intent.consumedAt) {
      return {
        ok: false,
        code: "used_confirmation_id",
        status: 409,
        message: "Confirmation ID was already used. Prepare the publish again."
      };
    }

    intent.consumedAt = new Date(now).toISOString();
    intents.set(confirmationId, intent);
    purgeExpiredIntents(now);

    return {
      ok: true,
      intent: {
        ...intent
      }
    };
  }

  return {
    appendHistoryEntry,
    consumePublishIntent,
    createPublishIntent,
    deleteDraft,
    getDraft,
    invalidatePersistedAuth,
    listDrafts,
    listHistory,
    loadDraftStore,
    loadPersistedAuth,
    loadSyncPostsStore,
    loadSyncState,
    saveDraft,
    savePersistedAuth,
    saveSyncPostsStore,
    saveSyncState,
    writeDraftStoreAtomically
  };
}