import crypto from "node:crypto";
import fs from "node:fs/promises";

const DRAFT_STORE_VERSION = 1;

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

function sortDraftsByUpdatedAt(drafts) {
  return drafts.sort((left, right) => {
    return String(right.updatedAt).localeCompare(String(left.updatedAt));
  });
}

function normalizeOptionalString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue ? normalizedValue : null;
}

function isValidMentionUrn(urn) {
  return /^urn:li:(?:person|member):[A-Za-z0-9_-]+$/.test(urn);
}

function normalizeMentions(rawMentions, errorCode) {
  if (rawMentions === undefined || rawMentions === null) {
    return null;
  }

  if (!Array.isArray(rawMentions)) {
    const error = new Error("Mentions must be provided as an array.");
    error.code = errorCode;
    throw error;
  }

  const mentions = rawMentions.map((mention) => {
    if (!mention || typeof mention !== "object") {
      const error = new Error("Each mention must be an object with name and urn.");
      error.code = errorCode;
      throw error;
    }

    const type = normalizeOptionalString(mention.type) || "person";
    const name = normalizeOptionalString(mention.name);
    const urn = normalizeOptionalString(mention.urn);

    if (type !== "person") {
      const error = new Error("Only person mentions are supported in this workflow.");
      error.code = errorCode;
      throw error;
    }

    if (!name || !urn) {
      const error = new Error("Person mentions require both name and urn.");
      error.code = errorCode;
      throw error;
    }

    if (!isValidMentionUrn(urn)) {
      const error = new Error(`Invalid LinkedIn mention URN: ${urn}`);
      error.code = errorCode;
      throw error;
    }

    return { type, name, urn };
  });

  return mentions.length > 0 ? mentions : null;
}

function normalizePostOptions(postOptions, errorCode) {
  if (!postOptions || typeof postOptions !== "object") {
    return null;
  }

  const articleSource = normalizeOptionalString(postOptions.article?.source);
  const articleTitle = normalizeOptionalString(postOptions.article?.title);
  const articleDescription = normalizeOptionalString(postOptions.article?.description);
  const articleThumbnailPath = normalizeOptionalString(postOptions.article?.thumbnailPath);
  const imagePath = normalizeOptionalString(postOptions.image?.path);
  const imageAltText = normalizeOptionalString(postOptions.image?.altText);
  const mentions = normalizeMentions(postOptions.mentions, errorCode);

  const hasArticle = [articleSource, articleTitle, articleDescription, articleThumbnailPath].some(Boolean);
  const hasImage = [imagePath, imageAltText].some(Boolean);
  const hasMentions = Array.isArray(mentions) && mentions.length > 0;

  if (!hasArticle && !hasImage && !hasMentions) {
    return null;
  }

  if (hasArticle && hasImage) {
    const error = new Error("Article preview and single image are mutually exclusive in this workflow.");
    error.code = errorCode;
    throw error;
  }

  if (hasArticle) {
    if (!articleSource || !articleTitle || !articleDescription) {
      const error = new Error("Article posts require source, title, and description.");
      error.code = errorCode;
      throw error;
    }

    return {
      article: {
        source: articleSource,
        title: articleTitle,
        description: articleDescription,
        thumbnailPath: articleThumbnailPath
      },
      ...(hasMentions ? { mentions } : {})
    };
  }

  if (!hasImage) {
    return {
      mentions
    };
  }

  if (!imagePath) {
    const error = new Error("Image posts require image.path.");
    error.code = errorCode;
    throw error;
  }

  return {
    image: {
      path: imagePath,
      altText: imageAltText
    },
    ...(hasMentions ? { mentions } : {})
  };
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

  async function loadIntentsStore() {
    await ensureLocalDataDir();
    const raw = await readUtf8File(appConfig.publishIntentsFilePath);
    if (!raw) {
      return new Map();
    }
    try {
      const parsed = JSON.parse(raw);
      return new Map(Object.entries(parsed));
    } catch {
      return new Map();
    }
  }

  async function saveIntentsStore(intentsMap) {
    await ensureLocalDataDir();
    await writeJsonFileAtomically(appConfig.publishIntentsFilePath, Object.fromEntries(intentsMap));
  }

  async function listDrafts() {
    const store = await loadDraftStore();
    return sortDraftsByUpdatedAt(Object.values(store.drafts));
  }

  async function getDraft(draftId) {
    const store = await loadDraftStore();
    return store.drafts[draftId] || null;
  }

  async function saveDraft({ draftId, content, postOptions }) {
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (!normalizedContent) {
      const error = new Error("Draft content must be a non-empty string.");
      error.code = "invalid_draft_content";
      throw error;
    }

    const normalizedPostOptions = normalizePostOptions(postOptions, "invalid_draft_post_options");

    const store = await loadDraftStore();
    const existingDraft = draftId ? store.drafts[draftId] : null;
    const now = new Date().toISOString();
    const nextDraftId = existingDraft?.draftId || draftId || crypto.randomUUID();

    const nextDraft = {
      draftId: nextDraftId,
      content: normalizedContent,
      postOptions: normalizedPostOptions,
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

  function purgeExpiredIntents(intentsMap, now = Date.now()) {
    for (const [confirmationId, intent] of intentsMap.entries()) {
      if (Date.parse(intent.expiresAt) <= now) {
        intentsMap.delete(confirmationId);
      }
    }
  }

  async function createPublishIntent({ draftId = null, content, postOptions, rawContent = null, scheduledFor = null, timezone = null }) {
    const normalizedContent = typeof content === "string" ? content.trim() : "";

    if (!normalizedContent) {
      const error = new Error("Publish content must be a non-empty string.");
      error.code = "invalid_publish_content";
      throw error;
    }

    const normalizedPostOptions = normalizePostOptions(postOptions, "invalid_publish_post_options");

    const now = Date.now();
    const confirmationId = crypto.randomUUID();
    const intent = {
      confirmationId,
      draftId,
      content: normalizedContent,
      ...(rawContent ? { rawContent: rawContent.trim() } : {}),
      postOptions: normalizedPostOptions,
      ...(scheduledFor ? { scheduledFor } : {}),
      ...(timezone ? { timezone } : {}),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + appConfig.publishIntentTtlMs).toISOString(),
      consumedAt: null
    };

    const intentsMap = await loadIntentsStore();
    purgeExpiredIntents(intentsMap, now);
    intentsMap.set(confirmationId, intent);
    await saveIntentsStore(intentsMap);

    return {
      confirmationId: intent.confirmationId,
      draftId: intent.draftId,
      content: intent.content,
      ...(intent.rawContent ? { rawContent: intent.rawContent } : {}),
      postOptions: intent.postOptions,
      ...(intent.scheduledFor ? { scheduledFor: intent.scheduledFor } : {}),
      ...(intent.timezone ? { timezone: intent.timezone } : {}),
      expiresAt: intent.expiresAt
    };
  }

  async function consumePublishIntent(confirmationId) {
    const now = Date.now();
    const intentsMap = await loadIntentsStore();
    const intent = intentsMap.get(confirmationId);

    if (!intent) {
      purgeExpiredIntents(intentsMap, now);
      await saveIntentsStore(intentsMap);

      return {
        ok: false,
        code: "invalid_confirmation_id",
        status: 400,
        message: "Confirmation ID is invalid or already consumed."
      };
    }

    if (Date.parse(intent.expiresAt) <= now) {
      intentsMap.delete(confirmationId);
      purgeExpiredIntents(intentsMap, now);
      await saveIntentsStore(intentsMap);

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
    intentsMap.set(confirmationId, intent);
    purgeExpiredIntents(intentsMap, now);
    await saveIntentsStore(intentsMap);

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
    listDrafts,
    listHistory,
    loadDraftStore,
    saveDraft,
    writeDraftStoreAtomically
  };
}