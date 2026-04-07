import { config } from "./config.js";
import { createLocalState } from "./local-state.js";
import { publishPost, getAnalytics, resolveMention, getStatus } from "./zernio.js";

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

function resolvePostOptions(flags) {
  const articleSource = resolveStringFlag(flags, "article-source");
  const articleTitle = resolveStringFlag(flags, "article-title");
  const articleDescription = resolveStringFlag(flags, "article-description");
  const articleThumbnailPath = resolveStringFlag(flags, "article-thumbnail-path");
  const imagePath = resolveStringFlag(flags, "image-path");
  const imageAlt = resolveStringFlag(flags, "image-alt");

  const hasArticle = [articleSource, articleTitle, articleDescription, articleThumbnailPath].some(Boolean);
  const hasImage = [imagePath, imageAlt].some(Boolean);

  if (!hasArticle && !hasImage) {
    return undefined;
  }

  return {
    article: hasArticle
      ? { source: articleSource, title: articleTitle, description: articleDescription, thumbnailPath: articleThumbnailPath }
      : undefined,
    image: hasImage
      ? { path: imagePath, altText: imageAlt }
      : undefined
  };
}

async function main() {
  const [domain, action, ...rest] = process.argv.slice(2);
  const { flags, positionals } = parseArgs(rest);

  if (!domain) {
    printJson({
      error: "missing_command",
      message: "Use status, draft, publish, history, analytics, or mention commands."
    });
    process.exitCode = 1;
    return;
  }

  const localState = createLocalState(config);

  try {
    if (domain === "status") {
      printJson(await getStatus());
      return;
    }

    if (domain === "draft" && action === "create") {
      const content = resolveContent(flags);
      if (!content) {
        printJson({ error: "missing_content", message: "--content is required." });
        process.exitCode = 1;
        return;
      }
      printJson(await localState.saveDraft({ content, postOptions: resolvePostOptions(flags) }));
      return;
    }

    if (domain === "draft" && action === "list") {
      printJson(await localState.listDrafts());
      return;
    }

    if (domain === "draft" && action === "show") {
      const draftId = resolveDraftId(positionals, flags);
      if (!draftId) {
        printJson({ error: "missing_draft_id", message: "--draft-id is required." });
        process.exitCode = 1;
        return;
      }
      const draft = await localState.getDraft(draftId);
      if (!draft) {
        printJson({ error: "draft_not_found", message: `Draft ${draftId} not found.` });
        process.exitCode = 1;
        return;
      }
      printJson(draft);
      return;
    }

    if (domain === "draft" && action === "update") {
      const draftId = resolveDraftId(positionals, flags);
      if (!draftId) {
        printJson({ error: "missing_draft_id", message: "--draft-id is required." });
        process.exitCode = 1;
        return;
      }
      printJson(await localState.saveDraft({ draftId, content: resolveContent(flags), postOptions: resolvePostOptions(flags) }));
      return;
    }

    if (domain === "draft" && action === "delete") {
      const draftId = resolveDraftId(positionals, flags);
      if (!draftId) {
        printJson({ error: "missing_draft_id", message: "--draft-id is required." });
        process.exitCode = 1;
        return;
      }
      const deleted = await localState.deleteDraft(draftId);
      printJson({ ok: deleted, draftId });
      return;
    }

    if (domain === "publish" && action === "prepare") {
      const draftId = resolveStringFlag(flags, "draft-id");
      let content = resolveContent(flags);
      let postOptions = resolvePostOptions(flags);

      if (draftId) {
        const draft = await localState.getDraft(draftId);
        if (!draft) {
          printJson({ error: "draft_not_found", message: `Draft ${draftId} not found.` });
          process.exitCode = 1;
          return;
        }
        content = content || draft.content;
        postOptions = postOptions || draft.postOptions;
      }

      if (!content) {
        printJson({ error: "missing_content", message: "--content or --draft-id with content is required." });
        process.exitCode = 1;
        return;
      }

      printJson(localState.createPublishIntent({ draftId, content, postOptions }));
      return;
    }

    if (domain === "publish" && action === "confirm") {
      const confirmationId = resolveConfirmationId(positionals, flags);
      if (!confirmationId) {
        printJson({ error: "missing_confirmation_id", message: "--confirmation-id is required." });
        process.exitCode = 1;
        return;
      }

      const result = localState.consumePublishIntent(confirmationId);
      if (!result.ok) {
        printJson({ error: result.code, message: result.message });
        process.exitCode = 1;
        return;
      }

      const intent = result.intent;
      const publishOptions = { publishNow: true };

      if (intent.postOptions?.image?.path) {
        publishOptions.imagePaths = [intent.postOptions.image.path];
      }

      if (config.zernioOrganizationUrn) {
        publishOptions.organizationUrn = config.zernioOrganizationUrn;
      }

      if (intent.postOptions?.article?.source) {
        publishOptions.firstComment = intent.postOptions.article.source;
      }

      const zernioResult = await publishPost({
        content: intent.content,
        accountId: config.zernioAccountId,
        options: publishOptions
      });

      const historyEntry = {
        confirmationId: intent.confirmationId,
        draftId: intent.draftId,
        content: intent.content,
        postOptions: intent.postOptions,
        publishedAt: new Date().toISOString(),
        zernioResponse: zernioResult
      };

      await localState.appendHistoryEntry(historyEntry);
      printJson(historyEntry);
      return;
    }

    if (domain === "history" && action === "list") {
      const limit = resolveLimit(flags);
      printJson(await localState.listHistory(limit ? { limit } : undefined));
      return;
    }

    if (domain === "analytics" && (action === "get" || !action)) {
      printJson(await getAnalytics({
        accountId: config.zernioAccountId,
        profileId: resolveStringFlag(flags, "profile-id"),
        options: {
          postId: resolveStringFlag(flags, "post-id"),
          fromDate: resolveStringFlag(flags, "from-date"),
          toDate: resolveStringFlag(flags, "to-date"),
          limit: resolveLimit(flags),
          sortBy: resolveStringFlag(flags, "sort-by")
        }
      }));
      return;
    }

    if (domain === "mention" && action === "resolve") {
      const query = resolveStringFlag(flags, "query") || positionals[0];
      if (!query) {
        printJson({ error: "missing_query", message: "--query or positional argument is required." });
        process.exitCode = 1;
        return;
      }
      printJson(await resolveMention({ nameOrUrl: query }));
      return;
    }

    printJson({
      error: "unknown_command",
      message: "Supported commands: status, draft create|list|show|update|delete, publish prepare|confirm, history list, analytics [get], mention resolve."
    });
    process.exitCode = 1;
  } catch (error) {
    printJson({
      error: error.code || "cli_error",
      message: error.message
    });
    process.exitCode = 1;
  }
}

main();