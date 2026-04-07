import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { config } from "./config.js";
import {
  buildAuthorizationUrl,
  createPost,
  createState,
  createTextPost,
  exchangeCodeForToken,
  getUserInfo,
  listAuthorPosts,
  personUrnFromUserInfo,
  renderPostCommentary
} from "./linkedin.js";
import { DraftStoreCorruptedError, createLocalState } from "./local-state.js";

function normalizePostComparisonText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function tokenizePostComparisonText(value) {
  return normalizePostComparisonText(value)
    .replace(/[^\p{L}\p{N}\s#]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function calculateTextSimilarity(leftText, rightText) {
  const leftTokens = [...new Set(tokenizePostComparisonText(leftText))];
  const rightTokens = [...new Set(tokenizePostComparisonText(rightText))];

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }

  const rightTokenSet = new Set(rightTokens);
  const overlapCount = leftTokens.filter((token) => rightTokenSet.has(token)).length;
  const denominator = Math.max(leftTokens.length, rightTokens.length);

  if (denominator === 0) {
    return 0;
  }

  const overlapRatio = overlapCount / denominator;
  const shorterCoverage = overlapCount / Math.min(leftTokens.length, rightTokens.length);

  return Number(((overlapRatio * 0.7) + (shorterCoverage * 0.3)).toFixed(4));
}

function buildMatchedPostSummary(syncedPost, matchType, similarityScore = null) {
  return {
    postKey: syncedPost.postKey,
    url: syncedPost.url || null,
    publishedAt: syncedPost.publishedAt || null,
    publishedAtText: syncedPost.publishedAtText || null,
    excerpt: buildPostExcerpt(syncedPost.text),
    matchType,
    similarityScore
  };
}

function buildPostExcerpt(text, maxLength = 160) {
  const normalizedText = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";

  if (!normalizedText) {
    return null;
  }

  if (normalizedText.length <= maxLength) {
    return normalizedText;
  }

  return `${normalizedText.slice(0, maxLength - 1).trim()}...`;
}

async function findDuplicatePost(localState, content) {
  const normalizedContent = normalizePostComparisonText(content);

  if (!normalizedContent) {
    return {
      hasDuplicate: false,
      match: null
    };
  }

  const postsStore = await localState.loadSyncPostsStore();
  const similarMatches = [];

  for (const syncedPost of postsStore.posts || []) {
    const normalizedPostText = normalizePostComparisonText(syncedPost.text);

    if (!normalizedPostText) {
      continue;
    }

    if (normalizedPostText === normalizedContent) {
      return {
        status: "exact",
        hasDuplicate: true,
        hasSimilar: false,
        match: buildMatchedPostSummary(syncedPost, "exact", 1),
        similarMatches: []
      };
    }

    const similarityScore = calculateTextSimilarity(normalizedContent, normalizedPostText);

    if (similarityScore >= 0.72) {
      similarMatches.push(buildMatchedPostSummary(syncedPost, "similar", similarityScore));
    }
  }

  similarMatches.sort((left, right) => (right.similarityScore || 0) - (left.similarityScore || 0));
  const topSimilarMatches = similarMatches.slice(0, 3);

  return {
    status: topSimilarMatches.length > 0 ? "similar" : "none",
    hasDuplicate: false,
    hasSimilar: topSimilarMatches.length > 0,
    match: topSimilarMatches[0] || null,
    similarMatches: topSimilarMatches
  };
}

function clearSessionAuth(req) {
  delete req.session.linkedinAccessToken;
  delete req.session.linkedinUser;
  delete req.session.linkedinPersonUrn;
  delete req.session.linkedinScope;
  delete req.session.linkedinExpiresAt;
}

function syncSessionAuth(req, auth) {
  req.session.linkedinAccessToken = auth.accessToken;
  req.session.linkedinUser = auth.user;
  req.session.linkedinPersonUrn = auth.personUrn;
  req.session.linkedinScope = auth.scope;
  req.session.linkedinExpiresAt = auth.expiresAt;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function toExpiresAt(tokenResponse) {
  if (!Number.isFinite(Number(tokenResponse.expires_in))) {
    return null;
  }

  return new Date(Date.now() + Number(tokenResponse.expires_in) * 1000).toISOString();
}

function userSummaryFromUserInfo(userInfo) {
  const derivedName = [userInfo.given_name, userInfo.family_name].filter(Boolean).join(" ").trim();

  return {
    sub: userInfo.sub,
    name: userInfo.name || derivedName || userInfo.email || userInfo.sub
  };
}

function buildAuthFailureResponse(appConfig, reason, message) {
  return {
    authenticated: false,
    state: "reauth_required",
    reason,
    reauthUrl: appConfig.authUrl,
    message
  };
}

export function createApp(options = {}) {
  const appConfig = options.config || config;
  const linkedinApi = options.linkedin || {
    buildAuthorizationUrl,
    createPost,
    createTextPost,
    exchangeCodeForToken,
    getUserInfo,
    listAuthorPosts
  };
  const localState = options.localState || createLocalState(appConfig);
  const app = express();

  async function handleLinkedinUnauthorized(req) {
    await localState.invalidatePersistedAuth({ reason: "linkedin_401" });
    clearSessionAuth(req);
  }

  async function appendHistoryOrThrow(entry, publishedContext = null) {
    try {
      await localState.appendHistoryEntry(entry);
    } catch (error) {
      const persistenceError = new Error("Publish history could not be persisted.");
      persistenceError.code = "publish_history_persistence_failed";
      persistenceError.status = 500;
      persistenceError.publishedContext = publishedContext;
      persistenceError.cause = error;
      throw persistenceError;
    }
  }

  app.use(express.json());
  app.use(
    session({
      secret: appConfig.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 8
      }
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true, host: appConfig.serverHost, port: appConfig.port });
  });

  app.get("/", asyncHandler(async (req, res) => {
    const authStatus = await localState.loadPersistedAuth();
    const userName = authStatus.authenticated ? authStatus.auth.user.name : "Nao autenticado";

    res.type("html").send(`
      <html>
        <head>
          <meta charset="utf-8" />
          <title>LinkedIn Copilot Publishing Assistant</title>
          <style>
            body { font-family: sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; }
            code, pre { background: #f5f5f5; padding: 2px 6px; border-radius: 6px; }
            pre { padding: 12px; overflow: auto; }
            a { color: #0a66c2; }
          </style>
        </head>
        <body>
          <h1>LinkedIn Copilot Publishing Assistant</h1>
          <p>Status: <strong>${authStatus.authenticated ? "conectado" : "reauth obrigatoria"}</strong></p>
          <p>Usuario: <strong>${userName}</strong></p>
          <p><a href="/auth/linkedin">Conectar com LinkedIn</a></p>
          <p>Fluxo canonico:</p>
          <pre>npm run dev
npm run linkedin:auth
npm run linkedin:status
npm run linkedin:draft:create -- --content="Meu rascunho"
npm run linkedin:publish:prepare -- --draft-id=&lt;uuid&gt;
npm run linkedin:publish:confirm -- --confirmation-id=&lt;uuid&gt;</pre>
          <p>Endpoints principais:</p>
          <pre>GET  /me
GET  /posts
GET  /operator/status
GET  /operator/drafts
POST /operator/drafts
POST /operator/publish/prepare
POST /operator/publish/confirm
GET  /operator/history
POST /logout</pre>
          <p>Publicacao direta em <code>POST /posts</code> foi desabilitada para evitar bypass do passo de confirmacao.</p>
        </body>
      </html>
    `);
  }));

  app.get("/auth/linkedin", (req, res) => {
    const state = createState();
    req.session.linkedinOAuthState = state;
    res.redirect(linkedinApi.buildAuthorizationUrl ? linkedinApi.buildAuthorizationUrl(state) : buildAuthorizationUrl(state));
  });

  app.get("/auth/linkedin/callback", asyncHandler(async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    if (error) {
      return res.status(400).json({
        error,
        errorDescription
      });
    }

    if (!code || !state || state !== req.session.linkedinOAuthState) {
      return res.status(400).json({
        error: "invalid_oauth_state",
        message: "State invalido ou callback incompleto."
      });
    }

    try {
      const tokenResponse = await linkedinApi.exchangeCodeForToken(code);
      const userInfo = await linkedinApi.getUserInfo(tokenResponse.access_token);
      const persistedAuth = await localState.savePersistedAuth({
        accessToken: tokenResponse.access_token,
        expiresAt: toExpiresAt(tokenResponse),
        scope: tokenResponse.scope || appConfig.linkedinScopes.join(" "),
        personUrn: personUrnFromUserInfo(userInfo),
        user: userSummaryFromUserInfo(userInfo)
      });

      syncSessionAuth(req, persistedAuth);
      delete req.session.linkedinOAuthState;

      return res.redirect("/");
    } catch (requestError) {
      return res.status(requestError.status || 500).json({
        error: "oauth_callback_failed",
        message: requestError.message,
        details: requestError.payload || null
      });
    }
  }));

  app.get("/me", asyncHandler(async (req, res) => {
    const authStatus = await localState.loadPersistedAuth();

    if (!authStatus.authenticated) {
      clearSessionAuth(req);
      return res.status(401).json(authStatus);
    }

    syncSessionAuth(req, authStatus.auth);

    return res.json({
      profile: authStatus.auth.user,
      personUrn: authStatus.auth.personUrn,
      tokenInfo: {
        expiresAt: authStatus.auth.expiresAt,
        scope: authStatus.auth.scope || appConfig.linkedinScopes.join(" ")
      }
    });
  }));

  app.get("/posts", asyncHandler(async (req, res) => {
    const authStatus = await localState.loadPersistedAuth();

    if (!authStatus.authenticated) {
      clearSessionAuth(req);
      return res.status(401).json(authStatus);
    }

    try {
      const posts = await linkedinApi.listAuthorPosts({
        accessToken: authStatus.auth.accessToken,
        authorUrn: authStatus.auth.personUrn,
        count: Number(req.query.count || 10)
      });

      syncSessionAuth(req, authStatus.auth);
      return res.json(posts);
    } catch (requestError) {
      if (requestError.status === 401) {
        await handleLinkedinUnauthorized(req);
        return res.status(401).json(
          buildAuthFailureResponse(
            appConfig,
            "linkedin_401",
            "LinkedIn rejected the stored token. Open the browser login URL to re-authenticate."
          )
        );
      }

      const status = requestError.status || 500;
      const isPermissionIssue = status === 403;

      return res.status(status).json({
        error: "list_posts_failed",
        message: isPermissionIssue
          ? "Sua app provavelmente nao possui o escopo restrito r_member_social. O endpoint /me continua funcionando sem ele."
          : requestError.message,
        details: requestError.payload || null
      });
    }
  }));

  app.post("/posts", (_req, res) => {
    return res.status(409).json({
      error: "direct_publish_disabled",
      message: "Direct publish is disabled. Use /operator/publish/prepare and /operator/publish/confirm or the npm CLI workflow."
    });
  });

  app.get("/operator/status", asyncHandler(async (_req, res) => {
    const authStatus = await localState.loadPersistedAuth();
    res.json(authStatus);
  }));

  app.get("/operator/drafts", asyncHandler(async (_req, res) => {
    const drafts = await localState.listDrafts();
    res.json({ drafts });
  }));

  app.post("/operator/drafts", asyncHandler(async (req, res) => {
    renderPostCommentary(req.body?.content, req.body?.postOptions || null);

    const duplicateCheck = await findDuplicatePost(localState, req.body?.content);
    const draft = await localState.saveDraft({
      content: req.body?.content,
      postOptions: req.body?.postOptions
    });

    res.status(201).json({
      ...draft,
      duplicateCheck,
      warning: duplicateCheck.hasDuplicate
        ? "Ja existe um post igual sincronizado no LinkedIn."
        : duplicateCheck.hasSimilar
          ? "Encontramos posts parecidos no historico sincronizado."
          : null
    });
  }));

  app.get("/operator/drafts/:draftId", asyncHandler(async (req, res) => {
    const draft = await localState.getDraft(req.params.draftId);

    if (!draft) {
      return res.status(404).json({
        error: "draft_not_found",
        message: `Draft ${req.params.draftId} was not found.`
      });
    }

    return res.json(draft);
  }));

  app.patch("/operator/drafts/:draftId", asyncHandler(async (req, res) => {
    const existingDraft = await localState.getDraft(req.params.draftId);

    if (!existingDraft) {
      return res.status(404).json({
        error: "draft_not_found",
        message: `Draft ${req.params.draftId} was not found.`
      });
    }

    renderPostCommentary(req.body?.content, req.body?.postOptions || null);

    const duplicateCheck = await findDuplicatePost(localState, req.body?.content);
    const draft = await localState.saveDraft({
      draftId: req.params.draftId,
      content: req.body?.content,
      postOptions: req.body?.postOptions
    });

    return res.json({
      ...draft,
      duplicateCheck,
      warning: duplicateCheck.hasDuplicate
        ? "Ja existe um post igual sincronizado no LinkedIn."
        : duplicateCheck.hasSimilar
          ? "Encontramos posts parecidos no historico sincronizado."
          : null
    });
  }));

  app.delete("/operator/drafts/:draftId", asyncHandler(async (req, res) => {
    const deleted = await localState.deleteDraft(req.params.draftId);

    if (!deleted) {
      return res.status(404).json({
        error: "draft_not_found",
        message: `Draft ${req.params.draftId} was not found.`
      });
    }

    return res.json({
      deleted: true,
      draftId: req.params.draftId
    });
  }));

  app.get("/operator/history", asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit || 20);
    const entries = await localState.listHistory({ limit: Number.isFinite(limit) ? limit : 20 });
    res.json({ entries });
  }));

  app.post("/operator/resolve/person-urn", asyncHandler(async (req, res) => {
    const url = req.body?.url;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "missing_field", message: "url is required." });
    }
    const { resolvePersonUrnFromProfileUrl } = await import("./linkedin-sync.js");
    const result = await resolvePersonUrnFromProfileUrl({ profileUrl: url, appConfig: config });
    res.json(result);
  }));

  app.post("/operator/publish/prepare", asyncHandler(async (req, res) => {
    const authStatus = await localState.loadPersistedAuth();

    if (!authStatus.authenticated) {
      clearSessionAuth(req);
      return res.status(401).json(authStatus);
    }

    let draftId = req.body?.draftId || null;
    let content = req.body?.content;
    let postOptions = req.body?.postOptions;
    const allowDuplicate = req.body?.allowDuplicate === true;

    if (draftId) {
      const draft = await localState.getDraft(draftId);

      if (!draft) {
        return res.status(404).json({
          error: "draft_not_found",
          message: `Draft ${draftId} was not found.`
        });
      }

      content = draft.content;
      postOptions = draft.postOptions || null;
    }

    const preparedContent = renderPostCommentary(content, postOptions);

    const duplicateCheck = await findDuplicatePost(localState, preparedContent);

    if (duplicateCheck.hasDuplicate && !allowDuplicate) {
      return res.status(409).json({
        error: "duplicate_post_detected",
        message: "Ja existe um post sincronizado com o mesmo conteudo em posts.json. Revise o texto ou confirme com allowDuplicate=true se quiser publicar mesmo assim.",
        draftId,
        duplicateCheck
      });
    }

    const intent = localState.createPublishIntent({
      draftId,
      content: preparedContent,
      postOptions
    });

    return res.status(201).json({
      ...intent,
      duplicateCheck,
      allowDuplicate,
      warning: duplicateCheck.hasSimilar && !duplicateCheck.hasDuplicate
        ? "Encontramos posts parecidos no historico sincronizado. Revise antes de publicar."
        : null
    });
  }));

  app.post("/operator/publish/confirm", asyncHandler(async (req, res) => {
    const authStatus = await localState.loadPersistedAuth();
    const confirmationId = req.body?.confirmationId;
    const confirmed = req.body?.confirm === true;
    const attemptId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    if (!authStatus.authenticated) {
      clearSessionAuth(req);
      return res.status(401).json(authStatus);
    }

    if (!confirmationId || !confirmed) {
      const rejectedEntry = {
        attemptId,
        confirmationId: confirmationId || null,
        draftId: null,
        status: "rejected",
        timestamp,
        error: confirmed ? "missing_confirmation_id" : "confirm_must_be_true"
      };

      await appendHistoryOrThrow(rejectedEntry);

      return res.status(400).json({
        error: rejectedEntry.error,
        message: "Confirm with { confirmationId, confirm: true }."
      });
    }

    const intentResult = localState.consumePublishIntent(confirmationId);

    if (!intentResult.ok) {
      const rejectedEntry = {
        attemptId,
        confirmationId,
        draftId: null,
        status: "rejected",
        timestamp,
        error: intentResult.code
      };

      await appendHistoryOrThrow(rejectedEntry);

      return res.status(intentResult.status).json({
        error: intentResult.code,
        message: intentResult.message
      });
    }

    const { intent } = intentResult;

    let publishResult;

    try {
      const publishMethod = linkedinApi.createPost || linkedinApi.createTextPost;

      publishResult = await publishMethod({
        accessToken: authStatus.auth.accessToken,
        authorUrn: authStatus.auth.personUrn,
        content: intent.content,
        postOptions: intent.postOptions || null,
        visibility: "PUBLIC"
      });
    } catch (requestError) {
      if (requestError.status === 401) {
        await handleLinkedinUnauthorized(req);
      }

      const failedEntry = {
        attemptId,
        confirmationId,
        draftId: intent.draftId,
        status: "failed",
        timestamp,
        content: intent.content,
        postOptions: intent.postOptions || null,
        error: requestError.status === 401 ? "linkedin_401" : requestError.message,
        details: requestError.payload || null
      };

      await appendHistoryOrThrow(failedEntry);

      if (requestError.status === 401) {
        return res.status(401).json(
          buildAuthFailureResponse(
            appConfig,
            "linkedin_401",
            "LinkedIn rejected the stored token. Open the browser login URL to re-authenticate."
          )
        );
      }

      return res.status(requestError.status || 500).json({
        error: "create_post_failed",
        message: requestError.message,
        details: requestError.payload || null
      });
    }

    const successEntry = {
      attemptId,
      confirmationId,
      draftId: intent.draftId,
      status: "published",
      timestamp,
      postId: publishResult.postId || null,
      content: intent.content,
      postOptions: intent.postOptions || null
    };

    await appendHistoryOrThrow(successEntry, {
      published: true,
      postId: publishResult.postId || null,
      confirmationId,
      attemptId
    });

    syncSessionAuth(req, authStatus.auth);

    return res.status(201).json({
      success: true,
      attemptId,
      confirmationId,
      postId: publishResult.postId || null,
      response: publishResult.payload
    });
  }));

  app.post("/logout", asyncHandler(async (req, res) => {
    await localState.invalidatePersistedAuth({ reason: "logout" });

    req.session.destroy(() => {
      res.json({ success: true });
    });
  }));

  app.use((error, _req, res, _next) => {
    if (error instanceof DraftStoreCorruptedError) {
      return res.status(500).json({
        error: error.code,
        message: error.message,
        backupPath: error.backupPath
      });
    }

    if (
      error.code === "invalid_draft_content"
      || error.code === "invalid_publish_content"
      || error.code === "invalid_draft_post_options"
      || error.code === "invalid_publish_post_options"
      || error.code === "invalid_media_file"
      || error.code === "missing_media_file"
      || error.code === "image_upload_init_failed"
      || error.code === "mention_token_not_found"
      || error.code === "mention_token_ambiguous"
    ) {
      return res.status(400).json({
        error: error.code,
        message: error.message
      });
    }

    if (error.code === "publish_history_persistence_failed") {
      return res.status(500).json({
        error: error.code,
        message: error.message,
        published: Boolean(error.publishedContext?.published),
        postId: error.publishedContext?.postId || null,
        attemptId: error.publishedContext?.attemptId || null,
        confirmationId: error.publishedContext?.confirmationId || null
      });
    }

    return res.status(error.status || 500).json({
      error: error.code || "internal_error",
      message: error.message
    });
  });

  return {
    app,
    config: appConfig,
    localState
  };
}

export function startServer(options = {}) {
  const { app, config: appConfig } = createApp(options);

  return app.listen(appConfig.port, appConfig.serverHost, () => {
    console.log(`LinkedIn API demo running on ${appConfig.appBaseUrl}`);
  });
}