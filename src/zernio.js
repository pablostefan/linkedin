import childProcess from "node:child_process";

function runZernio(args) {
  return new Promise((resolve, reject) => {
    childProcess.execFile("npx", ["zernio", ...args], { shell: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
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

export async function publishPost({ content, accountId, options = {} }) {
  const args = ["post", "create", "--content", content, "--account-id", accountId, "--platform", "linkedin"];

  if (options.publishNow) {
    args.push("--publish-now");
  }

  if (options.isDraft) {
    args.push("--draft");
  }

  if (options.scheduledFor) {
    args.push("--scheduled-for", options.scheduledFor);
  }

  if (options.timezone) {
    args.push("--timezone", options.timezone);
  }

  if (options.organizationUrn) {
    args.push("--organization-urn", options.organizationUrn);
  }

  if (options.firstComment) {
    args.push("--first-comment", options.firstComment);
  }

  if (options.disableLinkPreview) {
    args.push("--disable-link-preview");
  }

  if (options.hashtags?.length) {
    args.push("--hashtags", options.hashtags.join(","));
  }

  if (options.tags?.length) {
    args.push("--tags", options.tags.join(","));
  }

  if (options.imagePaths?.length) {
    for (const imagePath of options.imagePaths) {
      args.push("--image", imagePath);
    }
  }

  return runZernio(args);
}

export async function getAnalytics({ accountId, profileId, options = {} }) {
  const args = ["analytics", "get", "--account-id", accountId, "--platform", "linkedin"];

  if (profileId) {
    args.push("--profile-id", profileId);
  }

  if (options.postId) {
    args.push("--post-id", options.postId);
  }

  if (options.fromDate) {
    args.push("--from-date", options.fromDate);
  }

  if (options.toDate) {
    args.push("--to-date", options.toDate);
  }

  if (options.limit) {
    args.push("--limit", String(options.limit));
  }

  if (options.sortBy) {
    args.push("--sort-by", options.sortBy);
  }

  return runZernio(args);
}

export async function resolveMention({ nameOrUrl }) {
  const args = ["linkedin", "resolve-mention", "--query", nameOrUrl];
  return runZernio(args);
}

export async function getStatus() {
  return runZernio(["status"]);
}
