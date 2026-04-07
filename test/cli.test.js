import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CLI_PATH = new URL("../src/cli.js", import.meta.url).pathname;

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    execFile(
      "node",
      [CLI_PATH, ...args],
      {
        env: { ...process.env, ...env },
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        let parsed = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // stdout may not be JSON
        }
        resolve({
          exitCode: error?.code ?? 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          json: parsed
        });
      }
    );
  });
}

describe("cli", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("no command", () => {
    it("prints error when no domain provided", async () => {
      const result = await runCli([]);
      assert.equal(result.json?.error, "missing_command");
      assert.notEqual(result.exitCode, 0);
    });
  });

  describe("unknown command", () => {
    it("prints error for unknown domain", async () => {
      const result = await runCli(["foobar"]);
      assert.equal(result.json?.error, "unknown_command");
    });
  });

  describe("draft create", () => {
    it("creates a draft with content", async () => {
      const result = await runCli(["draft", "create", "--content", "Hello CLI"], { LOCAL_DATA_DIR: tempDir });
      assert.ok(result.json?.draftId);
      assert.equal(result.json?.content, "Hello CLI");
    });

    it("fails when --content is missing", async () => {
      const result = await runCli(["draft", "create"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_content");
    });

    it("creates draft with article options", async () => {
      const result = await runCli([
        "draft", "create",
        "--content", "Article post",
        "--article-source", "https://example.com",
        "--article-title", "My Article",
        "--article-description", "Description"
      ], { LOCAL_DATA_DIR: tempDir });
      assert.ok(result.json?.draftId);
      assert.equal(result.json?.postOptions?.article?.source, "https://example.com");
    });

    it("creates draft with image options", async () => {
      const result = await runCli([
        "draft", "create",
        "--content", "Image post",
        "--image-path", "/tmp/test.png",
        "--image-alt", "A test image"
      ], { LOCAL_DATA_DIR: tempDir });
      assert.ok(result.json?.draftId);
      assert.equal(result.json?.postOptions?.image?.path, "/tmp/test.png");
    });
  });

  describe("draft list", () => {
    it("returns empty array when no drafts", async () => {
      const result = await runCli(["draft", "list"], { LOCAL_DATA_DIR: tempDir });
      assert.deepEqual(result.json, []);
    });

    it("lists created drafts", async () => {
      await runCli(["draft", "create", "--content", "Draft A"], { LOCAL_DATA_DIR: tempDir });
      await runCli(["draft", "create", "--content", "Draft B"], { LOCAL_DATA_DIR: tempDir });
      const result = await runCli(["draft", "list"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.length, 2);
    });
  });

  describe("draft show", () => {
    it("shows a draft by id", async () => {
      const created = await runCli(["draft", "create", "--content", "Show me"], { LOCAL_DATA_DIR: tempDir });
      const result = await runCli(["draft", "show", "--draft-id", created.json.draftId], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.content, "Show me");
    });

    it("fails when --draft-id is missing", async () => {
      const result = await runCli(["draft", "show"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_draft_id");
    });

    it("fails when draft not found", async () => {
      const result = await runCli(["draft", "show", "--draft-id", "non-existent"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "draft_not_found");
    });
  });

  describe("draft update", () => {
    it("updates draft content", async () => {
      const created = await runCli(["draft", "create", "--content", "Original"], { LOCAL_DATA_DIR: tempDir });
      const result = await runCli(["draft", "update", "--draft-id", created.json.draftId, "--content", "Updated"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.content, "Updated");
      assert.equal(result.json?.draftId, created.json.draftId);
    });

    it("fails when --draft-id is missing", async () => {
      const result = await runCli(["draft", "update", "--content", "New"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_draft_id");
    });
  });

  describe("draft delete", () => {
    it("deletes existing draft", async () => {
      const created = await runCli(["draft", "create", "--content", "Delete me"], { LOCAL_DATA_DIR: tempDir });
      const result = await runCli(["draft", "delete", "--draft-id", created.json.draftId], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.ok, true);
    });

    it("returns ok=false for non-existent draft", async () => {
      const result = await runCli(["draft", "delete", "--draft-id", "non-existent"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.ok, false);
    });

    it("fails when --draft-id is missing", async () => {
      const result = await runCli(["draft", "delete"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_draft_id");
    });
  });

  describe("publish prepare", () => {
    it("prepares publish from draft", async () => {
      const created = await runCli(["draft", "create", "--content", "Publish this"], { LOCAL_DATA_DIR: tempDir });
      const result = await runCli(["publish", "prepare", "--draft-id", created.json.draftId], { LOCAL_DATA_DIR: tempDir });
      assert.ok(result.json?.confirmationId);
      assert.equal(result.json?.content, "Publish this");
    });

    it("prepares publish from inline content", async () => {
      const result = await runCli(["publish", "prepare", "--content", "Inline post"], { LOCAL_DATA_DIR: tempDir });
      assert.ok(result.json?.confirmationId);
      assert.equal(result.json?.content, "Inline post");
    });

    it("fails when no content or draft-id", async () => {
      const result = await runCli(["publish", "prepare"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_content");
    });

    it("fails when draft not found", async () => {
      const result = await runCli(["publish", "prepare", "--draft-id", "non-existent"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "draft_not_found");
    });
  });

  describe("publish confirm", () => {
    it("fails when --confirmation-id is missing", async () => {
      const result = await runCli(["publish", "confirm"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_confirmation_id");
    });

    it("fails for invalid confirmation id", async () => {
      const result = await runCli(["publish", "confirm", "--confirmation-id", "bogus"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "invalid_confirmation_id");
    });
  });

  describe("history list", () => {
    it("returns empty array when no history", async () => {
      const result = await runCli(["history", "list"], { LOCAL_DATA_DIR: tempDir });
      assert.deepEqual(result.json, []);
    });
  });

  describe("mention resolve", () => {
    it("fails when --query is missing", async () => {
      const result = await runCli(["mention", "resolve"], { LOCAL_DATA_DIR: tempDir });
      assert.equal(result.json?.error, "missing_query");
    });
  });
});
