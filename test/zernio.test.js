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
    it("calls npx zernio status", async () => {
      fakeExecFileSuccess({ ok: true });
      const result = await getStatus();
      assert.deepEqual(result, { ok: true });
      const args = lastCallArgs();
      assert.deepEqual(args, ["zernio", "status"]);
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
        "zernio", "post", "create",
        "--content", "Hello",
        "--account-id", "acc-1",
        "--platform", "linkedin"
      ]);
    });

    it("includes --publish-now when option set", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { publishNow: true } });
      assert.ok(lastCallArgs().includes("--publish-now"));
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
      const idx = args.indexOf("--scheduled-for");
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
      assert.ok(args.includes("--scheduled-for"));
      assert.ok(args.includes("--timezone"));
      assert.equal(args[args.indexOf("--scheduled-for") + 1], "2025-07-01T09:00:00Z");
      assert.equal(args[args.indexOf("--timezone") + 1], "America/Sao_Paulo");
    });

    it("includes --organization-urn when provided", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { organizationUrn: "urn:li:organization:123" } });
      const args = lastCallArgs();
      assert.ok(args.includes("--organization-urn"));
      assert.ok(args.includes("urn:li:organization:123"));
    });

    it("includes --first-comment when provided", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { firstComment: "link here" } });
      const args = lastCallArgs();
      const idx = args.indexOf("--first-comment");
      assert.ok(idx >= 0);
      assert.equal(args[idx + 1], "link here");
    });

    it("includes --disable-link-preview when set", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { disableLinkPreview: true } });
      assert.ok(lastCallArgs().includes("--disable-link-preview"));
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

    it("adds --image for each imagePath", async () => {
      fakeExecFileSuccess({ id: "post-1" });
      await publishPost({ content: "Hi", accountId: "acc-1", options: { imagePaths: ["/a.png", "/b.png"] } });
      const args = lastCallArgs();
      const imageArgs = args.filter((a) => a === "--image");
      assert.equal(imageArgs.length, 2);
    });
  });

  describe("getAnalytics", () => {
    it("builds minimal args with accountId", async () => {
      fakeExecFileSuccess({ data: [] });
      await getAnalytics({ accountId: "acc-1" });
      const args = lastCallArgs();
      assert.deepEqual(args, [
        "zernio", "analytics", "get",
        "--account-id", "acc-1",
        "--platform", "linkedin"
      ]);
    });

    it("includes profile-id when provided", async () => {
      fakeExecFileSuccess({ data: [] });
      await getAnalytics({ accountId: "acc-1", profileId: "prof-1" });
      const args = lastCallArgs();
      assert.ok(args.includes("--profile-id"));
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
      assert.ok(args.includes("--post-id"));
      assert.ok(args.includes("--from-date"));
      assert.ok(args.includes("--to-date"));
      assert.ok(args.includes("--limit"));
      assert.ok(args.includes("--sort-by"));
      assert.ok(args.includes("10"));
      assert.ok(args.includes("impressions"));
    });
  });

  describe("resolveMention", () => {
    it("builds correct args", async () => {
      fakeExecFileSuccess({ urn: "urn:li:person:abc" });
      await resolveMention({ nameOrUrl: "https://linkedin.com/in/someone" });
      const args = lastCallArgs();
      assert.deepEqual(args, [
        "zernio", "linkedin", "resolve-mention",
        "--query", "https://linkedin.com/in/someone"
      ]);
    });

    it("returns parsed JSON result", async () => {
      fakeExecFileSuccess({ urn: "urn:li:person:abc", name: "Someone" });
      const result = await resolveMention({ nameOrUrl: "Someone" });
      assert.equal(result.urn, "urn:li:person:abc");
      assert.equal(result.name, "Someone");
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
