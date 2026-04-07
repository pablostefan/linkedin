import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createLocalState, DraftStoreCorruptedError } from "../src/local-state.js";

function makeTempConfig() {
  const dir = path.join(os.tmpdir(), `linkedin-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return {
    localDataDir: dir,
    draftsFilePath: path.join(dir, "drafts.json"),
    draftsBackupFilePath: path.join(dir, "drafts.bak.json"),
    publishHistoryFilePath: path.join(dir, "history.jsonl"),
    publishIntentTtlMs: 5 * 60 * 1000
  };
}

describe("local-state", () => {
  let appConfig;
  let state;

  beforeEach(() => {
    appConfig = makeTempConfig();
    state = createLocalState(appConfig);
  });

  afterEach(async () => {
    await fs.rm(appConfig.localDataDir, { recursive: true, force: true });
  });

  describe("DraftStoreCorruptedError", () => {
    it("includes file path and backup path in message", () => {
      const err = new DraftStoreCorruptedError("/a/drafts.json", "/a/drafts.bak.json", new Error("parse"));
      assert.match(err.message, /corrupted/);
      assert.match(err.message, /drafts\.json/);
      assert.match(err.message, /backup/);
      assert.equal(err.code, "drafts_file_corrupted");
    });

    it("handles missing backup path", () => {
      const err = new DraftStoreCorruptedError("/a/drafts.json", null, new Error("parse"));
      assert.match(err.message, /No draft backup/);
    });
  });

  describe("saveDraft and getDraft", () => {
    it("creates a new draft with generated id", async () => {
      const draft = await state.saveDraft({ content: "Hello world" });
      assert.ok(draft.draftId);
      assert.equal(draft.content, "Hello world");
      assert.ok(draft.createdAt);
      assert.ok(draft.updatedAt);
    });

    it("retrieves saved draft by id", async () => {
      const draft = await state.saveDraft({ content: "Test" });
      const found = await state.getDraft(draft.draftId);
      assert.deepEqual(found, draft);
    });

    it("updates existing draft preserving createdAt", async () => {
      const original = await state.saveDraft({ content: "v1" });
      const updated = await state.saveDraft({ draftId: original.draftId, content: "v2" });
      assert.equal(updated.draftId, original.draftId);
      assert.equal(updated.content, "v2");
      assert.equal(updated.createdAt, original.createdAt);
    });

    it("trims content whitespace", async () => {
      const draft = await state.saveDraft({ content: "  trimmed  " });
      assert.equal(draft.content, "trimmed");
    });

    it("rejects empty content", async () => {
      await assert.rejects(() => state.saveDraft({ content: "" }), (err) => {
        assert.equal(err.code, "invalid_draft_content");
        return true;
      });
    });

    it("rejects whitespace-only content", async () => {
      await assert.rejects(() => state.saveDraft({ content: "   " }), (err) => {
        assert.equal(err.code, "invalid_draft_content");
        return true;
      });
    });

    it("returns null for non-existent draft", async () => {
      const found = await state.getDraft("non-existent-id");
      assert.equal(found, null);
    });

    it("saves draft with article post options", async () => {
      const draft = await state.saveDraft({
        content: "Check this out",
        postOptions: {
          article: {
            source: "https://example.com",
            title: "Title",
            description: "Desc"
          }
        }
      });
      assert.ok(draft.postOptions);
      assert.equal(draft.postOptions.article.source, "https://example.com");
    });

    it("saves draft with image post options", async () => {
      const draft = await state.saveDraft({
        content: "Look at this",
        postOptions: {
          image: { path: "/tmp/img.png", altText: "screenshot" }
        }
      });
      assert.ok(draft.postOptions);
      assert.equal(draft.postOptions.image.path, "/tmp/img.png");
    });

    it("rejects article + image in same draft", async () => {
      await assert.rejects(() => state.saveDraft({
        content: "Both",
        postOptions: {
          article: { source: "https://x.com", title: "T", description: "D" },
          image: { path: "/tmp/img.png" }
        }
      }), (err) => {
        assert.equal(err.code, "invalid_draft_post_options");
        return true;
      });
    });

    it("saves draft with mentions", async () => {
      const draft = await state.saveDraft({
        content: "Hey @someone",
        postOptions: {
          mentions: [{ name: "Pablo", urn: "urn:li:person:abc123" }]
        }
      });
      assert.ok(draft.postOptions.mentions);
      assert.equal(draft.postOptions.mentions[0].name, "Pablo");
    });
  });

  describe("listDrafts", () => {
    it("returns empty array when no drafts", async () => {
      const drafts = await state.listDrafts();
      assert.deepEqual(drafts, []);
    });

    it("returns drafts sorted by updatedAt descending", async () => {
      await state.saveDraft({ content: "First" });
      await state.saveDraft({ content: "Second" });
      await state.saveDraft({ content: "Third" });
      const drafts = await state.listDrafts();
      assert.equal(drafts.length, 3);
      assert.ok(drafts[0].updatedAt >= drafts[1].updatedAt);
      assert.ok(drafts[1].updatedAt >= drafts[2].updatedAt);
    });
  });

  describe("deleteDraft", () => {
    it("returns true when draft exists", async () => {
      const draft = await state.saveDraft({ content: "Delete me" });
      const result = await state.deleteDraft(draft.draftId);
      assert.equal(result, true);
      const found = await state.getDraft(draft.draftId);
      assert.equal(found, null);
    });

    it("returns false when draft does not exist", async () => {
      const result = await state.deleteDraft("non-existent");
      assert.equal(result, false);
    });
  });

  describe("loadDraftStore", () => {
    it("returns empty store when no file exists", async () => {
      const store = await state.loadDraftStore();
      assert.equal(store.version, 1);
      assert.deepEqual(store.drafts, {});
    });

    it("throws DraftStoreCorruptedError for invalid JSON", async () => {
      await fs.mkdir(appConfig.localDataDir, { recursive: true });
      await fs.writeFile(appConfig.draftsFilePath, "not json", "utf8");
      await assert.rejects(() => state.loadDraftStore(), (err) => {
        assert.ok(err instanceof DraftStoreCorruptedError);
        return true;
      });
    });
  });

  describe("createPublishIntent and consumePublishIntent", () => {
    it("creates intent with confirmation id", () => {
      const intent = state.createPublishIntent({ content: "Publish this" });
      assert.ok(intent.confirmationId);
      assert.equal(intent.content, "Publish this");
      assert.ok(intent.expiresAt);
    });

    it("consumes valid intent", () => {
      const intent = state.createPublishIntent({ content: "Publish this" });
      const result = state.consumePublishIntent(intent.confirmationId);
      assert.equal(result.ok, true);
      assert.equal(result.intent.content, "Publish this");
      assert.ok(result.intent.consumedAt);
    });

    it("rejects invalid confirmation id", () => {
      const result = state.consumePublishIntent("bogus-id");
      assert.equal(result.ok, false);
      assert.equal(result.code, "invalid_confirmation_id");
    });

    it("rejects already consumed intent", () => {
      const intent = state.createPublishIntent({ content: "Once" });
      state.consumePublishIntent(intent.confirmationId);
      const result = state.consumePublishIntent(intent.confirmationId);
      assert.equal(result.ok, false);
      assert.equal(result.code, "used_confirmation_id");
    });

    it("rejects expired intent", () => {
      // Create with very short TTL
      const shortConfig = { ...appConfig, publishIntentTtlMs: 1 };
      const shortState = createLocalState(shortConfig);
      const intent = shortState.createPublishIntent({ content: "Expire me" });

      // Advance time by consuming after a delay of ~2ms
      const start = Date.now();
      while (Date.now() - start < 5) { /* busy wait */ }

      const result = shortState.consumePublishIntent(intent.confirmationId);
      assert.equal(result.ok, false);
      assert.equal(result.code, "expired_confirmation_id");
    });

    it("includes draftId when provided", () => {
      const intent = state.createPublishIntent({ draftId: "d-1", content: "With draft" });
      assert.equal(intent.draftId, "d-1");
    });

    it("includes rawContent when provided", () => {
      const intent = state.createPublishIntent({ content: "Final", rawContent: "  Raw  " });
      assert.equal(intent.rawContent, "Raw");
    });

    it("rejects empty publish content", () => {
      assert.throws(() => state.createPublishIntent({ content: "" }), (err) => {
        assert.equal(err.code, "invalid_publish_content");
        return true;
      });
    });
  });

  describe("appendHistoryEntry and listHistory", () => {
    it("appends and retrieves entries", async () => {
      await state.appendHistoryEntry({ id: 1, content: "First" });
      await state.appendHistoryEntry({ id: 2, content: "Second" });
      const history = await state.listHistory();
      assert.equal(history.length, 2);
      // Newest first
      assert.equal(history[0].id, 2);
      assert.equal(history[1].id, 1);
    });

    it("respects limit parameter", async () => {
      await state.appendHistoryEntry({ id: 1 });
      await state.appendHistoryEntry({ id: 2 });
      await state.appendHistoryEntry({ id: 3 });
      const history = await state.listHistory({ limit: 2 });
      assert.equal(history.length, 2);
    });

    it("returns empty array when no history", async () => {
      const history = await state.listHistory();
      assert.deepEqual(history, []);
    });
  });
});
