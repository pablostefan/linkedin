import fs from "node:fs/promises";
import path from "node:path";
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