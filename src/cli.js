import { config } from "./config.js";
import { createLocalState } from "./local-state.js";

function parseArgs(argv) {
  const flags = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const [flagName, inlineValue] = value.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      flags[flagName] = inlineValue;
      continue;
    }

    const nextValue = argv[index + 1];

    if (!nextValue || nextValue.startsWith("--")) {
      flags[flagName] = true;
      continue;
    }

    flags[flagName] = nextValue;
    index += 1;
  }

  return { flags, positionals };
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function requestJson(method, path, body) {
  const response = await fetch(`${config.appBaseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : { message: await response.text() };

  return {
    ok: response.ok,
    status: response.status,
    payload
  };
}

function resolveDraftId(positionals, flags) {
  return flags["draft-id"] || positionals[0] || null;
}

function resolveConfirmationId(positionals, flags) {
  return flags["confirmation-id"] || positionals[0] || null;
}

function resolveContent(flags) {
  return flags.content || null;
}

function resolveBooleanFlag(flags, name, fallback = false) {
  const value = flags[name];

  if (value === undefined) {
    return fallback;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function resolveMaxScrolls(flags) {
  const rawValue = flags["max-scrolls"];

  if (rawValue === undefined) {
    return undefined;
  }

  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function resolveLoginTimeoutMs(flags) {
  const rawValue = flags["login-timeout-ms"];

  if (rawValue === undefined) {
    return undefined;
  }

  const parsedValue = Number(rawValue);

  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

function resolveLimit(flags) {
  const rawValue = flags.limit;

  if (rawValue === undefined) {
    return undefined;
  }

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : undefined;
}

function resolveStringFlag(flags, name) {
  const value = flags[name];
  return value === undefined ? undefined : String(value);
}

async function resolveMentions(flags) {
  const personName = resolveStringFlag(flags, "mention-person-name");
  const personUrn = resolveStringFlag(flags, "mention-person-urn");
  const personUrl = resolveStringFlag(flags, "mention-person-url");
  const personEmail = resolveStringFlag(flags, "mention-person-email");

  if (personName === undefined && personUrn === undefined && personUrl === undefined && personEmail === undefined) {
    return undefined;
  }

  let resolvedUrn = personUrn;

  if (!resolvedUrn && personEmail) {
    const { resolvePersonUrnByEmail } = await import("./linkedin.js");
    const localState = createLocalState(config);
    const authStatus = await localState.loadPersistedAuth();
    if (!authStatus.authenticated) {
      throw new Error("Authentication required to resolve person URN by email. Run: npm run linkedin:auth");
    }
    resolvedUrn = await resolvePersonUrnByEmail({ accessToken: authStatus.auth.accessToken, email: personEmail });
  }

  if (!resolvedUrn && personUrl) {
    const { resolvePersonUrnFromProfileUrl } = await import("./linkedin-sync.js");
    const result = await resolvePersonUrnFromProfileUrl({ profileUrl: personUrl });
    resolvedUrn = result.personUrn;
  }

  if (!resolvedUrn && personName) {
    const localState = createLocalState(config);
    const { connections } = await localState.loadConnections();

    if (connections.length === 0) {
      throw new Error("No cached connections. Run: npm run linkedin:connections:sync");
    }

    const matches = localState.findConnectionByName(connections, personName);

    if (matches.length === 1) {
      resolvedUrn = matches[0].personUrn;
    } else if (matches.length > 1) {
      const list = matches.map((c) => `  - ${c.firstName} ${c.lastName} (${c.personUrn})`).join("\n");
      throw new Error(`Multiple connections match "${personName}":\n${list}\nUse --mention-person-urn to pick one.`);
    } else {
      throw new Error(`No connection found matching "${personName}". Run: npm run linkedin:connections:sync`);
    }
  }

  return [
    {
      type: "person",
      name: personName,
      urn: resolvedUrn
    }
  ];
}

async function resolvePostOptions(flags) {
  const articleSource = resolveStringFlag(flags, "article-source");
  const articleTitle = resolveStringFlag(flags, "article-title");
  const articleDescription = resolveStringFlag(flags, "article-description");
  const articleThumbnailPath = resolveStringFlag(flags, "article-thumbnail-path");
  const imagePath = resolveStringFlag(flags, "image-path");
  const imageAlt = resolveStringFlag(flags, "image-alt");
  const mentions = await resolveMentions(flags);

  const hasArticle = [articleSource, articleTitle, articleDescription, articleThumbnailPath].some(Boolean);
  const hasImage = [imagePath, imageAlt].some(Boolean);
  const hasMentions = Array.isArray(mentions) && mentions.length > 0;

  if (!hasArticle && !hasImage && !hasMentions) {
    return undefined;
  }

  return {
    article: hasArticle
      ? {
          source: articleSource,
          title: articleTitle,
          description: articleDescription,
          thumbnailPath: articleThumbnailPath
        }
      : undefined,
    image: hasImage
      ? {
          path: imagePath,
          altText: imageAlt
        }
      : undefined,
    mentions
  };
}

async function main() {
  const [domain, action, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseArgs(rest);

  if (!domain) {
    printJson({
      error: "missing_command",
      message: "Use auth, posts, draft, publish, history, sync, or connections commands."
    });
    process.exitCode = 1;
    return;
  }

  try {
    let result;

    if (domain === "auth" && action === "login") {
      result = {
        authenticated: false,
        state: "reauth_required",
        reauthUrl: config.authUrl,
        message: "Open the URL in your browser to authenticate LinkedIn for the local operator workflow."
      };
      printJson(result);
      return;
    }

    if (domain === "sync" && action === "run") {
      const { runLinkedinBrowserSync } = await import("./linkedin-sync.js");
      result = {
        ok: true,
        status: 200,
        payload: await runLinkedinBrowserSync({
          appConfig: config,
          localState: createLocalState(config),
          startUrl: flags["start-url"] || config.linkedinSyncStartUrl,
          headless: resolveBooleanFlag(flags, "headless", false),
          maxScrolls: resolveMaxScrolls(flags),
          loginTimeoutMs: resolveLoginTimeoutMs(flags),
          fullScan: resolveBooleanFlag(flags, "full-scan", false),
          enrichAll: resolveBooleanFlag(flags, "enrich-all", false)
        })
      };
      printJson(result.payload);
      return;
    }

    if (domain === "sync" && action === "status") {
      const { getLinkedinSyncStatus } = await import("./linkedin-sync.js");
      result = {
        ok: true,
        status: 200,
        payload: await getLinkedinSyncStatus({
          appConfig: config,
          localState: createLocalState(config)
        })
      };
      printJson(result.payload);
      return;
    }

    if (domain === "sync" && action === "list") {
      const { listLinkedinSyncPosts } = await import("./linkedin-sync.js");
      result = {
        ok: true,
        status: 200,
        payload: await listLinkedinSyncPosts({
          appConfig: config,
          localState: createLocalState(config),
          limit: resolveLimit(flags),
          query: resolveStringFlag(flags, "query") || null,
          includeRawMetrics: resolveBooleanFlag(flags, "include-raw-metrics", false)
        })
      };
      printJson(result.payload);
      return;
    }

    if (domain === "resolve" && action === "person-urn") {
      const url = resolveStringFlag(flags, "url");
      if (!url) {
        printJson({ error: "missing_flag", message: "--url is required. Pass a LinkedIn profile URL." });
        process.exitCode = 1;
        return;
      }
      const { resolvePersonUrnFromProfileUrl } = await import("./linkedin-sync.js");
      result = await resolvePersonUrnFromProfileUrl({
        profileUrl: url,
        appConfig: config,
        headless: resolveBooleanFlag(flags, "headless", true)
      });
      printJson(result);
      return;
    }

    if (domain === "connections" && action === "sync") {
      const localState = createLocalState(config);
      const authStatus = await localState.loadPersistedAuth();
      if (!authStatus.authenticated) {
        printJson({ error: "not_authenticated", message: "Run: npm run linkedin:auth" });
        process.exitCode = 1;
        return;
      }
      const { fetchConnections } = await import("./linkedin.js");
      const connections = await fetchConnections({ accessToken: authStatus.auth.accessToken });
      await localState.saveConnections(connections);
      printJson({ ok: true, syncedCount: connections.length });
      return;
    }

    if (domain === "connections" && action === "list") {
      const localState = createLocalState(config);
      const { connections, syncedAt } = await localState.loadConnections();
      const query = resolveStringFlag(flags, "query");
      const filtered = query ? localState.findConnectionByName(connections, query) : connections;
      printJson({ syncedAt, total: connections.length, showing: filtered.length, connections: filtered });
      return;
    }

    if (domain === "auth" && action === "status") {
      result = await requestJson("GET", "/operator/status");
    } else if (domain === "posts" && action === "list") {
      const count = flags.count ? `?count=${encodeURIComponent(flags.count)}` : "";
      result = await requestJson("GET", `/posts${count}`);
    } else if (domain === "draft" && action === "create") {
      result = await requestJson("POST", "/operator/drafts", {
        content: resolveContent(flags),
        postOptions: await resolvePostOptions(flags)
      });
    } else if (domain === "draft" && action === "list") {
      result = await requestJson("GET", "/operator/drafts");
    } else if (domain === "draft" && action === "show") {
      result = await requestJson("GET", `/operator/drafts/${resolveDraftId(positionals, flags)}`);
    } else if (domain === "draft" && action === "update") {
      result = await requestJson("PATCH", `/operator/drafts/${resolveDraftId(positionals, flags)}`, {
        content: resolveContent(flags),
        postOptions: await resolvePostOptions(flags)
      });
    } else if (domain === "draft" && action === "delete") {
      result = await requestJson("DELETE", `/operator/drafts/${resolveDraftId(positionals, flags)}`);
    } else if (domain === "publish" && action === "prepare") {
      result = await requestJson("POST", "/operator/publish/prepare", {
        draftId: flags["draft-id"] || null,
        content: resolveContent(flags),
        allowDuplicate: resolveBooleanFlag(flags, "allow-duplicate", false),
        postOptions: await resolvePostOptions(flags)
      });
    } else if (domain === "publish" && action === "confirm") {
      result = await requestJson("POST", "/operator/publish/confirm", {
        confirmationId: resolveConfirmationId(positionals, flags),
        confirm: true
      });
    } else if (domain === "history" && action === "list") {
      const limit = flags.limit ? `?limit=${encodeURIComponent(flags.limit)}` : "";
      result = await requestJson("GET", `/operator/history${limit}`);
    } else {
      printJson({
        error: "unknown_command",
        message: "Supported commands: auth status|login, posts list, draft create|list|show|update|delete, publish prepare|confirm, history list, sync run|status|list, connections sync|list, resolve person-urn."
      });
      process.exitCode = 1;
      return;
    }

    printJson(result.payload);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    if (error.code === "browser_login_required" || error.code === "sync_failed" || error.code === "sync_store_corrupted") {
      printJson({
        error: error.code,
        message: error.message,
        reauthRequired: error.code === "browser_login_required",
        browserProfilePath: config.browserProfileDirPath,
        startUrl: config.linkedinSyncStartUrl
      });
      process.exitCode = 1;
      return;
    }

    if (domain === "resolve") {
      printJson({
        error: error.code || "resolve_failed",
        message: error.message,
        profileUrl: resolveStringFlag(flags, "url")
      });
      process.exitCode = 1;
      return;
    }

    if (domain === "sync") {
      printJson({
        error: error.code || "sync_failed",
        message: error.message,
        browserProfilePath: config.browserProfileDirPath,
        startUrl: flags["start-url"] || config.linkedinSyncStartUrl
      });
      process.exitCode = 1;
      return;
    }

    printJson({
      error: "server_unreachable",
      message: "The local operator server is not reachable. Start `npm run dev` and retry.",
      details: error.message
    });
    process.exitCode = 1;
  }
}

main();