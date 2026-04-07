import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const LINKEDIN_AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const LINKEDIN_USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const LINKEDIN_POSTS_URL = "https://api.linkedin.com/rest/posts";
const LINKEDIN_UGC_POSTS_URL = "https://api.linkedin.com/v2/ugcPosts";

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

export function renderUgcCommentary(content, postOptions = null) {
  const normalizedContent = typeof content === "string" ? content.trim() : "";
  const mentions = Array.isArray(postOptions?.mentions) ? postOptions.mentions : [];

  if (mentions.length === 0) {
    return { text: normalizedContent, attributes: [] };
  }

  let text = normalizedContent;
  const attributes = [];

  for (const mention of mentions) {
    const token = `@{${mention.name}}`;
    const index = text.indexOf(token);

    if (index === -1) {
      const error = new Error(`Mention placeholder was not found in content: ${token}`);
      error.code = "mention_token_not_found";
      throw error;
    }

    if (text.indexOf(token, index + 1) !== -1) {
      const error = new Error(`Mention placeholder must appear only once in content: ${token}`);
      error.code = "mention_token_ambiguous";
      throw error;
    }

    text = text.substring(0, index) + mention.name + text.substring(index + token.length);

    attributes.push({
      start: index,
      length: mention.name.length,
      value: {
        "com.linkedin.common.MemberAttributedEntity": {
          member: mention.urn
        }
      }
    });
  }

  return { text, attributes };
}

export function renderPostCommentary(content, postOptions = null) {
  const normalizedContent = typeof content === "string" ? content.trim() : "";
  const mentions = Array.isArray(postOptions?.mentions) ? postOptions.mentions : [];

  let commentary = normalizedContent;

  for (const mention of mentions) {
    const token = `@{${mention.name}}`;
    const occurrences = commentary.split(token).length - 1;

    if (occurrences === 0) {
      const error = new Error(`Mention placeholder was not found in content: ${token}`);
      error.code = "mention_token_not_found";
      throw error;
    }

    if (occurrences > 1) {
      const error = new Error(`Mention placeholder must appear only once in content: ${token}`);
      error.code = "mention_token_ambiguous";
      throw error;
    }

    commentary = commentary.replace(token, `@[${mention.name}](${mention.urn})`);
  }

  return commentary;
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

async function linkedinV2Request(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
      ...(options.headers || {})
    }
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = new Error(`LinkedIn V2 API request failed with ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return {
    payload,
    headers: response.headers
  };
}

function buildUgcPostBody({ authorUrn, text, attributes, visibility }) {
  return {
    author: authorUrn,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: {
          text,
          ...(attributes.length > 0 ? { attributes } : {})
        },
        shareMediaCategory: "NONE"
      }
    },
    visibility: {
      "com.linkedin.ugc.MemberNetworkVisibility": visibility || "PUBLIC"
    }
  };
}

export async function createUgcPost({ accessToken, authorUrn, content, postOptions = null, visibility = "PUBLIC" }) {
  const { text, attributes } = renderUgcCommentary(content, postOptions);

  const body = buildUgcPostBody({
    authorUrn,
    text,
    attributes,
    visibility
  });

  const { payload, headers } = await linkedinV2Request(accessToken, LINKEDIN_UGC_POSTS_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });

  return {
    payload,
    postId: headers.get("x-restli-id")
  };
}

function inferImageContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === ".png") {
    return "image/png";
  }

  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }

  if (extension === ".gif") {
    return "image/gif";
  }

  const error = new Error(`Unsupported image format for ${filePath}. Use PNG, JPG, JPEG, or GIF.`);
  error.code = "invalid_media_file";
  throw error;
}

async function uploadImageAsset({ accessToken, ownerUrn, filePath }) {
  let binaryPayload;

  try {
    binaryPayload = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      const missingFileError = new Error(`Image file was not found: ${filePath}`);
      missingFileError.code = "missing_media_file";
      throw missingFileError;
    }

    throw error;
  }

  const contentType = inferImageContentType(filePath);
  const { payload } = await linkedinRestRequest(accessToken, "https://api.linkedin.com/rest/images?action=initializeUpload", {
    method: "POST",
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: ownerUrn
      }
    })
  });

  const uploadUrl = payload?.value?.uploadUrl;
  const imageUrn = payload?.value?.image;

  if (!uploadUrl || !imageUrn) {
    const error = new Error("LinkedIn did not return an upload URL for the image asset.");
    error.code = "image_upload_init_failed";
    throw error;
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType
    },
    body: binaryPayload
  });

  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text().catch(() => "");
    const error = new Error(`LinkedIn image upload failed with ${uploadResponse.status}`);
    error.status = uploadResponse.status;
    error.payload = errorText || null;
    throw error;
  }

  return imageUrn;
}

function buildPostBody({ authorUrn, content, visibility, postOptions }) {
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

  if (postOptions?.article) {
    body.content = {
      article: {
        source: postOptions.article.source,
        title: postOptions.article.title,
        description: postOptions.article.description,
        ...(postOptions.article.thumbnail ? { thumbnail: postOptions.article.thumbnail } : {})
      }
    };
  }

  if (postOptions?.image) {
    body.content = {
      media: {
        id: postOptions.image.id,
        ...(postOptions.image.altText ? { altText: postOptions.image.altText } : {})
      }
    };
  }

  return body;
}

export async function createPost({ accessToken, authorUrn, content, visibility = "PUBLIC", postOptions = null }) {
  let resolvedPostOptions = postOptions;

  if (postOptions?.article?.thumbnailPath) {
    const thumbnailUrn = await uploadImageAsset({
      accessToken,
      ownerUrn: authorUrn,
      filePath: postOptions.article.thumbnailPath
    });

    resolvedPostOptions = {
      ...resolvedPostOptions,
      article: {
        ...resolvedPostOptions.article,
        thumbnail: thumbnailUrn
      }
    };
  }

  if (postOptions?.image?.path) {
    const imageUrn = await uploadImageAsset({
      accessToken,
      ownerUrn: authorUrn,
      filePath: postOptions.image.path
    });

    resolvedPostOptions = {
      image: {
        id: imageUrn,
        altText: postOptions.image.altText || null
      }
    };
  }

  const body = buildPostBody({
    authorUrn,
    content,
    visibility,
    postOptions: resolvedPostOptions
  });

  const { payload, headers } = await linkedinRestRequest(accessToken, LINKEDIN_POSTS_URL, {
    method: "POST",
    body: JSON.stringify(body)
  });

  return {
    payload,
    postId: headers.get("x-restli-id")
  };
}

export async function createTextPost({ accessToken, authorUrn, content, visibility = "PUBLIC" }) {
  return createPost({ accessToken, authorUrn, content, visibility, postOptions: null });
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

export async function fetchConnections({ accessToken, count = 50 }) {
  const connections = [];
  let start = 0;
  let total = Infinity;

  while (start < total) {
    const params = new URLSearchParams({
      q: "viewer",
      start: String(start),
      count: String(count)
    });

    const { payload } = await linkedinV2Request(accessToken, `https://api.linkedin.com/v2/connections?${params.toString()}`, {
      method: "GET"
    });

    const elements = Array.isArray(payload?.elements) ? payload.elements : [];

    for (const element of elements) {
      const personUrn = element.to;

      if (typeof personUrn === "string" && personUrn.startsWith("urn:li:person:")) {
        connections.push({
          personUrn,
          firstName: element.firstName || null,
          lastName: element.lastName || null,
          createdAt: element.createdAt ? new Date(element.createdAt).toISOString() : null
        });
      }
    }

    total = payload?.paging?.total ?? elements.length;
    start += elements.length;

    if (elements.length === 0) {
      break;
    }
  }

  return connections;
}

export async function resolvePersonUrnByEmail({ accessToken, email }) {
  const params = new URLSearchParams({
    q: "handleStrings",
    handleStrings: email
  });

  const { payload } = await linkedinV2Request(accessToken, `https://api.linkedin.com/v2/clientAwareMemberHandles?${params.toString()}`, {
    method: "GET"
  });

  const elements = payload?.elements;

  if (!Array.isArray(elements) || elements.length === 0) {
    const error = new Error(`No LinkedIn member found for email: ${email}`);
    error.code = "person_urn_not_found";
    throw error;
  }

  const memberHandle = elements[0];
  const personUrn = memberHandle?.member;

  if (!personUrn || !personUrn.startsWith("urn:li:person:")) {
    const error = new Error(`Unexpected member handle response for email: ${email}`);
    error.code = "person_urn_invalid_response";
    error.payload = memberHandle;
    throw error;
  }

  return personUrn;
}