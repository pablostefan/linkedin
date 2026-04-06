import { config } from "./config.js";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";

export function createState() {
  return crypto.randomUUID();
}

export function buildAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.linkedinClientId,
    redirect_uri: config.linkedinRedirectUri,
    state,
    scope: config.linkedinScopes.join(" ")
  });

  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.linkedinRedirectUri,
    client_id: config.linkedinClientId,
    client_secret: config.linkedinClientSecret
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export async function getUserInfo(accessToken) {
  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`LinkedIn userinfo failed: ${JSON.stringify(payload)}`);
  }

  return payload;
}

export function personUrnFromUserInfo(userInfo) {
  return `urn:li:person:${userInfo.sub}`;
}

async function linkedinRestRequest(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "Linkedin-Version": config.linkedinApiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(`LinkedIn API request failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    payload,
    headers: response.headers
  };
}

export async function createTextPost({ accessToken, authorUrn, content, visibility = "PUBLIC" }) {
  const body = {
    author: authorUrn,
    commentary: content,
    visibility,
    distribution: {
      feedDistribution: "MAIN_FEED",
      targetEntities: [],
      thirdPartyDistributionChannels: []
    },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false
  };

  const { payload, headers } = await linkedinRestRequest(accessToken, LINKEDIN_POSTS_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });

  return {
    payload,
    postId: headers.get("x-restli-id")
  };
}

export async function listAuthorPosts({ accessToken, authorUrn, count = 10 }) {
  const params = new URLSearchParams({
    q: "author",
    author: authorUrn,
    count: String(count),
    sortBy: "LAST_MODIFIED"
  });

  const { payload } = await linkedinRestRequest(accessToken, `${LINKEDIN_POSTS_URL}?${params.toString()}`, {
    method: "GET"
  });

  return payload;
}