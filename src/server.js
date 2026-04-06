import express from "express";
import session from "express-session";
import { config } from "./config.js";
import {
  buildAuthorizationUrl,
  createState,
  createTextPost,
  exchangeCodeForToken,
  getUserInfo,
  listAuthorPosts,
  personUrnFromUserInfo
} from "./linkedin.js";

const app = express();

app.use(express.json());
app.use(
  session({
    secret: config.sessionSecret,
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

function requireAuth(req, res, next) {
  if (!req.session.linkedinAccessToken || !req.session.linkedinUser) {
    return res.status(401).json({
      error: "not_authenticated",
      message: "Conecte sua conta em /auth/linkedin antes de usar este endpoint."
    });
  }

  return next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/", (req, res) => {
  const isAuthenticated = Boolean(req.session.linkedinAccessToken);
  const userName = req.session.linkedinUser?.name || "Nao autenticado";

  res.type("html").send(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>LinkedIn Official API Demo</title>
        <style>
          body { font-family: sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; }
          code, pre { background: #f5f5f5; padding: 2px 6px; border-radius: 6px; }
          pre { padding: 12px; overflow: auto; }
          a { color: #0a66c2; }
        </style>
      </head>
      <body>
        <h1>LinkedIn Official API Demo</h1>
        <p>Status: <strong>${isAuthenticated ? "conectado" : "desconectado"}</strong></p>
        <p>Usuario: <strong>${userName}</strong></p>
        <p><a href="/auth/linkedin">Conectar com LinkedIn</a></p>
        <p>Endpoints principais:</p>
        <pre>GET  /me
GET  /posts
POST /posts
POST /logout</pre>
        <p>Exemplo para publicar um texto:</p>
        <pre>curl -X POST ${config.appBaseUrl}/posts \\
  -H "Content-Type: application/json" \\
  -b cookie.txt -c cookie.txt \\
  -d '{"content":"Meu primeiro post via API oficial do LinkedIn."}'</pre>
      </body>
    </html>
  `);
});

app.get("/auth/linkedin", (req, res) => {
  const state = createState();
  req.session.linkedinOAuthState = state;
  res.redirect(buildAuthorizationUrl(state));
});

app.get("/auth/linkedin/callback", async (req, res) => {
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
    const tokenResponse = await exchangeCodeForToken(code);
    const userInfo = await getUserInfo(tokenResponse.access_token);

    req.session.linkedinAccessToken = tokenResponse.access_token;
    req.session.linkedinTokenInfo = tokenResponse;
    req.session.linkedinUser = userInfo;
    req.session.linkedinPersonUrn = personUrnFromUserInfo(userInfo);
    delete req.session.linkedinOAuthState;

    return res.redirect("/");
  } catch (requestError) {
    return res.status(500).json({
      error: "oauth_callback_failed",
      message: requestError.message
    });
  }
});

app.get("/me", requireAuth, (req, res) => {
  res.json({
    profile: req.session.linkedinUser,
    personUrn: req.session.linkedinPersonUrn,
    tokenInfo: {
      expiresIn: req.session.linkedinTokenInfo?.expires_in,
      scope: req.session.linkedinTokenInfo?.scope || config.linkedinScopes.join(" ")
    }
  });
});

app.get("/posts", requireAuth, async (req, res) => {
  try {
    const posts = await listAuthorPosts({
      accessToken: req.session.linkedinAccessToken,
      authorUrn: req.session.linkedinPersonUrn,
      count: Number(req.query.count || 10)
    });

    return res.json(posts);
  } catch (requestError) {
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
});

app.post("/posts", requireAuth, async (req, res) => {
  const { content, visibility } = req.body || {};

  if (!content || typeof content !== "string") {
    return res.status(400).json({
      error: "invalid_body",
      message: "Envie um JSON com o campo content em texto."
    });
  }

  try {
    const result = await createTextPost({
      accessToken: req.session.linkedinAccessToken,
      authorUrn: req.session.linkedinPersonUrn,
      content,
      visibility: visibility || "PUBLIC"
    });

    return res.status(201).json({
      success: true,
      postId: result.postId,
      response: result.payload
    });
  } catch (requestError) {
    return res.status(requestError.status || 500).json({
      error: "create_post_failed",
      message: requestError.message,
      details: requestError.payload || null
    });
  }
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.listen(config.port, () => {
  console.log(`LinkedIn API demo running on ${config.appBaseUrl}`);
});