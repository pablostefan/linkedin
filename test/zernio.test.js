import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";

let publishPost, getAnalytics, resolveMention, getStatus;

describe("zernio", () => {
  let execFileMock;

  beforeEach(async () => {
    execFileMock = mock.method(childProcess, "execFile");
    // Re-import to pick up mock — dynamic import busts cache
    const mod = await import(`../src/zernio.js?t=${Date.now()}`);
    publishPost = mod.publishPost;
    getAnalytics = mod.getAnalytics;
    resolveMention = mod.resolveMention;
    getStatus = mod.getStatus;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  function fakeExecFileSuccess(stdout) {
    execFileMock.mock.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, JSON.stringify(stdout), "");
    });
  }

  function fakeExecFileFailure(stderr = "something broke") {
    execFileMock.mock.mockImplementation((_cmd, _args, _opts, cb) => {
      const err = new Error("exit 1");
      err.code = 1;
      cb(err, "", stderr);
    });
  }

  function lastCallArgs() {
    const calls = execFileMock.mock.calls;
    return calls[calls.length - 1].arguments[1]; // [1] = args array
  }

  describe("getStatus", () => {
    it("calls npx zernio auth:check", async () => {
      fakeExecFileSuccess({ ok: true });
      const result = await getStatus();
      assert.deepEqual(result, { ok: true });
      const args = lastCallArgs();
      assert.deepEqual(args, ["zernio", "auth:check"]);
    });

    it("rejects when CLI fails", async () => {
      fakeExecFileFailure("auth error");
      await assert.rejects(() => getStatus(), (err) => {
        assert.match(err.message, /Zernio CLI failed/);
        assert.equal(err.code, "zernio_cli_error");
        return true;
      });
    });
  });

  describe("publishPost", () => {
    it("builds minimal args with content and accountId", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hello", accountId: "acc-1" });
      const args = lastCallArgs();
      assert.deepEqual(args, [
        "zernio", "posts:create",
        "--text", "Hello",
        "--accounts", "acc-1"
      ]);
    });

    it("does not include unsupported --publish-now flag", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { publishNow: true } });
      assert.ok(!lastCallArgs().includes("--publish-now"));
    });

    it("includes --draft when option set", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { isDraft: true } });
      assert.ok(lastCallArgs().includes("--draft"));
    });

    it("includes --scheduled-for when provided", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { scheduledFor: "2025-01-01T10:00:00Z" } });
      const args = lastCallArgs();
      const idx = args.indexOf("--scheduledAt");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "2025-01-01T10:00:00Z");
    });

    it("includes --timezone when provided", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { timezone: "America/Sao_Paulo" } });
      const args = lastCallArgs();
      const idx = args.indexOf("--timezone");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "America/Sao_Paulo");
    });

    it("includes both --scheduled-for and --timezone together", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({
        content: "Hi",
        accountId: "acc-1",
        options: { scheduledFor: "2025-07-01T09:00:00Z", timezone: "America/Sao_Paulo" }
      });
      const args = lastCallArgs();
      assert.ok(args.includes("--scheduledAt"));
      assert.ok(args.includes("--timezone"));
      assert.equal(args[args.indexOf("--scheduledAt") + 1], "2025-07-01T09:00:00Z");
      assert.equal(args[args.indexOf("--timezone") + 1], "America/Sao_Paulo");
    });

    it("does not include unsupported organization flag", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { organizationUrn: "urn:li:organization:123" } });
      const args = lastCallArgs();
      assert.ok(!args.includes("--organization-urn"));
    });

    it("does not include unsupported first comment flag", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { firstComment: "link here" } });
      const args = lastCallArgs();
      assert.ok(!args.includes("--first-comment"));
    });

    it("does not include unsupported disable link preview flag", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { disableLinkPreview: true } });
      assert.ok(!lastCallArgs().includes("--disable-link-preview"));
    });

    it("joins hashtags with comma", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { hashtags: ["ai", "ml"] } });
      const args = lastCallArgs();
      const idx = args.indexOf("--hashtags");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "ai,ml");
    });

    it("joins tags with comma", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { tags: ["tag1", "tag2"] } });
      const args = lastCallArgs();
      const idx = args.indexOf("--tags");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "tag1,tag2");
    });

    it("joins image paths into --media", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { imagePaths: ["/a.png", "/b.png"] } });
      const args = lastCallArgs();
      const idx = args.indexOf("--media");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "/a.png,/b.png");
    });
  });

  describe("getAnalytics", () => {
    it("builds minimal args with accountId", async () => {
      fakeExecFileSuccess({ data: [] });
      await getAnalytics({ accountId: "acc-1" });
      const args = lastCallArgs();
      assert.deepEqual(args, [
        "zernio", "analytics:posts",
        "--accountId", "acc-1",
        "--platform", "linkedin"
      ]);
    });

    it("includes profile-id when provided", async () => {
      fakeExecFileSuccess({ data: [] });
      await getAnalytics({ accountId: "acc-1", profileId: "prof-1" });
      const args = lastCallArgs();
      assert.ok(args.includes("--profileId"));
      assert.ok(args.includes("prof-1"));
    });

    it("includes all optional parameters", async () => {
      fakeExecFileSuccess({ data: [] });
      await getAnalytics({
        accountId: "acc-1",
        options: {
          postId: "p1",
          fromDate: "2025-01-01",
          toDate: "2025-06-01",
          limit: 10,
          sortBy: "impressions"
        }
      });
      const args = lastCallArgs();
      assert.ok(args.includes("--postId"));
      assert.ok(args.includes("--fromDate"));
      assert.ok(args.includes("--toDate"));
      assert.ok(args.includes("--limit"));
      assert.ok(args.includes("--sortBy"));
      assert.ok(args.includes("10"));
      assert.ok(args.includes("impressions"));
    });
  });

  describe("resolveMention", () => {
    it("calls mention endpoint and returns parsed result", async () => {
      const original = process.env.ZERNIO_API_KEY;
      process.env.ZERNIO_API_KEY = "sk_test_key";

      const fetchMock = mock.method(globalThis, "fetch", async (url, options) => {
        assert.match(String(url), /\/accounts\/acc-1\/linkedin-mentions/);
        assert.match(String(url), /displayName=Someone(\+|%20)Name/);
        assert.equal(options.headers.Authorization, "Bearer sk_test_key");

        return {
          ok: true,
          text: async () => JSON.stringify({
            urn: "urn:li:person:abc",
            mentionFormat: "@[Someone Name](urn:li:person:abc)"
          })
        };
      });

      const result = await resolveMention({
        accountId: "acc-1",
        nameOrUrl: "https://linkedin.com/in/someone",
        displayName: "Someone Name"
      });

      assert.equal(result.urn, "urn:li:person:abc");
      assert.equal(result.mentionFormat, "@[Someone Name](urn:li:person:abc)");

      fetchMock.mock.restore();
      if (original) {
        process.env.ZERNIO_API_KEY = original;
      } else {
        delete process.env.ZERNIO_API_KEY;
      }
    });
  });

  describe("non-JSON stdout", () => {
    it("returns raw string when stdout is not JSON", async () => {
      execFileMock.mock.mockImplementation((_cmd, _args, _opts, cb) => {
        cb(null, "plain text output", "");
      });
      const result = await getStatus();
      assert.deepEqual(result, { raw: "plain text output" });
    });
  });
});
