import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runZernio(args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile("npx", ["zernio", ...args], { shell: false, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || error.message;
        const wrapped = new Error(`Zernio CLI failed: ${message}`);
        wrapped.code = "zernio_cli_error";
        wrapped.exitCode = error.code;
        wrapped.stderr = stderr;
        reject(wrapped);
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({ raw: stdout.trim() });
      }
    });
  });
}

async function resolveApiKey() {
  if (process.env.ZERNIO_API_KEY) {
    return process.env.ZERNIO_API_KEY;
  }

  const configPath = path.join(os.homedir(), ".zernio", "config.json");
  try {
    const raw = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.apiKey === "string" && parsed.apiKey.trim()) {
      return parsed.apiKey.trim();
    }
  } catch {
    // Fall through and return null.
  }

  return null;
}

function runZernioMentionResolve({ accountId, nameOrUrl, displayName, apiKey }) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(`https://zernio.com/api/v1/accounts/${accountId}/linkedin-mentions`);
    endpoint.searchParams.set("url", nameOrUrl);

    if (displayName) {
      endpoint.searchParams.set("displayName", displayName);
    }

    fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })
      .then(async (response) => {
        const payload = await response.text();
        let parsedPayload = null;

        try {
          parsedPayload = JSON.parse(payload);
        } catch {
          parsedPayload = { raw: payload };
        }

        if (!response.ok) {
          const message = parsedPayload?.message || `LinkedIn mention resolve failed with status ${response.status}`;
          const wrapped = new Error(`Zernio mention resolve failed: ${message}`);
          wrapped.code = "zernio_mention_resolve_error";
          wrapped.status = response.status;
          wrapped.details = parsedPayload;
          reject(wrapped);
          return;
        }

        resolve(parsedPayload);
      })
      .catch((error) => {
        const wrapped = new Error(`Zernio mention resolve failed: ${error.message}`);
        wrapped.code = "zernio_mention_resolve_error";
        reject(wrapped);
      });
  });
}

export async function publishPost({ content, accountId, options = {} }) {
  const args = ["posts:create", "--text", content, "--accounts", accountId];

  if (options.isDraft) {
    args.push("--draft");
  }

  if (options.scheduledFor) {
    args.push("--scheduledAt", options.scheduledFor);
  }

  if (options.timezone) {
    args.push("--timezone", options.timezone);
  }

  if (options.hashtags?.length) {
    args.push("--hashtags", options.hashtags.join(","));
  }

  if (options.tags?.length) {
    args.push("--tags", options.tags.join(","));
  }

  if (options.imagePaths?.length) {
    args.push("--media", options.imagePaths.join(","));
  }

  return runZernio(args);
}

export async function getAnalytics({ accountId, profileId, options = {} }) {
  const args = ["analytics:posts", "--accountId", accountId, "--platform", "linkedin"];

  if (options.postId) {
    args.push("--postId", options.postId);
  }

  if (options.fromDate) {
    args.push("--fromDate", options.fromDate);
  }

  if (options.toDate) {
    args.push("--toDate", options.toDate);
  }

  if (options.limit) {
    args.push("--limit", String(options.limit));
  }

  if (options.sortBy) {
    args.push("--sortBy", options.sortBy);
  }

  if (profileId) {
    args.push("--profileId", profileId);
  }

  return runZernio(args);
}

export async function resolveMention({ accountId, nameOrUrl, displayName }) {
  const apiKey = await resolveApiKey();
  if (!apiKey) {
    const error = new Error("ZERNIO_API_KEY not found. Run `zernio auth:login` or set ZERNIO_API_KEY.");
    error.code = "zernio_missing_api_key";
    throw error;
  }

  return runZernioMentionResolve({ accountId, nameOrUrl, displayName, apiKey });
}

export async function getStatus() {
  return runZernio(["auth:check"]);
}
