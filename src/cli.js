import { config } from "./config.js";

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

async function main() {
  const [domain, action, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseArgs(rest);

  if (!domain) {
    printJson({
      error: "missing_command",
      message: "Use auth, posts, draft, publish, or history commands."
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

    if (domain === "auth" && action === "status") {
      result = await requestJson("GET", "/operator/status");
    } else if (domain === "posts" && action === "list") {
      const count = flags.count ? `?count=${encodeURIComponent(flags.count)}` : "";
      result = await requestJson("GET", `/posts${count}`);
    } else if (domain === "draft" && action === "create") {
      result = await requestJson("POST", "/operator/drafts", {
        content: resolveContent(flags)
      });
    } else if (domain === "draft" && action === "list") {
      result = await requestJson("GET", "/operator/drafts");
    } else if (domain === "draft" && action === "show") {
      result = await requestJson("GET", `/operator/drafts/${resolveDraftId(positionals, flags)}`);
    } else if (domain === "draft" && action === "update") {
      result = await requestJson("PATCH", `/operator/drafts/${resolveDraftId(positionals, flags)}`, {
        content: resolveContent(flags)
      });
    } else if (domain === "draft" && action === "delete") {
      result = await requestJson("DELETE", `/operator/drafts/${resolveDraftId(positionals, flags)}`);
    } else if (domain === "publish" && action === "prepare") {
      result = await requestJson("POST", "/operator/publish/prepare", {
        draftId: flags["draft-id"] || null,
        content: resolveContent(flags)
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
        message: "Supported commands: auth status|login, posts list, draft create|list|show|update|delete, publish prepare|confirm, history list."
      });
      process.exitCode = 1;
      return;
    }

    printJson(result.payload);

    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printJson({
      error: "server_unreachable",
      message: "The local operator server is not reachable. Start `npm run dev` and retry.",
      details: error.message
    });
    process.exitCode = 1;
  }
}

main();