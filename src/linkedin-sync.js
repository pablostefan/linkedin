import crypto from "node:crypto";
import fs from "node:fs/promises";
import { config } from "./config.js";
import { createLocalState } from "./local-state.js";

const DEFAULT_MAX_SCROLLS = 6;
const DEFAULT_FULL_SCAN_MAX_SCROLLS = 60;
const KNOWN_POST_KEYS_LIMIT = 100;
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_BROWSER_WINDOW_WIDTH = 1600;
const DEFAULT_BROWSER_WINDOW_HEIGHT = 1200;
const LINKEDIN_DIRECT_LOGIN_URL = "https://www.linkedin.com/login";
const PERMALINK_ENRICH_LIMIT = 5;

function extractActivityUrn(value) {
  const text = normalizeVisibleText(value);

  if (!text) {
    return null;
  }

  const match = text.match(/urn:li:activity:\d+/i);
  return match ? match[0] : null;
}

function isEphemeralUrn(value) {
  const normalizedValue = normalizeVisibleText(value);
  return /^ember\d+$/i.test(normalizedValue);
}

function normalizeUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const url = new URL(rawUrl);
    return `${url.origin}${url.pathname}`;
  } catch (_error) {
    return rawUrl;
  }
}

function buildCanonicalLinkedinPostUrl(urn) {
  const activityUrn = extractActivityUrn(urn);
  return activityUrn ? `https://www.linkedin.com/feed/update/${activityUrn}/` : null;
}

export function normalizeVisibleText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeMetricCount(value) {
  const text = normalizeVisibleText(String(value || ""));

  if (!text) {
    return null;
  }

  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(mil|mi|k|m)?/i);

  if (!match) {
    return null;
  }

  const baseValue = Number.parseFloat(match[1].replace(",", "."));

  if (!Number.isFinite(baseValue)) {
    return null;
  }

  const suffix = (match[2] || "").toLowerCase();

  if (suffix === "k" || suffix === "mil") {
    return Math.round(baseValue * 1000);
  }

  if (suffix === "m" || suffix === "mi") {
    return Math.round(baseValue * 1000000);
  }

  return Math.round(baseValue);
}

function parseReactionSummaryCount(text) {
  const normalizedText = normalizeVisibleText(text);

  if (!normalizedText) {
    return null;
  }

  const namedReactionMatch = normalizedText.match(/mais\s+(\d+)\s+pessoas\s+reagiram/i);

  if (namedReactionMatch) {
    const extraCount = Number(namedReactionMatch[1]);
    return Number.isFinite(extraCount) ? extraCount + 1 : null;
  }

  const englishNamedReactionMatch = normalizedText.match(/and\s+(\d+)\s+others\s+reacted/i);

  if (englishNamedReactionMatch) {
    const extraCount = Number(englishNamedReactionMatch[1]);
    return Number.isFinite(extraCount) ? extraCount + 1 : null;
  }

  const directReactionMatch = normalizedText.match(/(\d+(?:[.,]\d+)?)\s+pessoas\s+reagiram/i);
  if (directReactionMatch) {
    return normalizeMetricCount(directReactionMatch[1]);
  }

  const englishDirectReactionMatch = normalizedText.match(/(\d+(?:[.,]\d+)?)\s+(?:people|others)\s+reacted/i);
  if (englishDirectReactionMatch) {
    return normalizeMetricCount(englishDirectReactionMatch[1]);
  }

  return null;
}

function normalizeTimestamp(value) {
  const text = normalizeVisibleText(value);

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeLinkedinTimestampText(value) {
  return normalizeVisibleText(value)
    .replace(/[•·]/g, " ")
    .replace(/\beditado\b/gi, " ")
    .replace(/\bedited\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function subtractFromDate(referenceDate, amount, unit) {
  const nextDate = new Date(referenceDate);

  if (unit === "minute") {
    nextDate.setMinutes(nextDate.getMinutes() - amount);
    return nextDate;
  }

  if (unit === "hour") {
    nextDate.setHours(nextDate.getHours() - amount);
    return nextDate;
  }

  if (unit === "day") {
    nextDate.setDate(nextDate.getDate() - amount);
    return nextDate;
  }

  if (unit === "week") {
    nextDate.setDate(nextDate.getDate() - amount * 7);
    return nextDate;
  }

  if (unit === "month") {
    nextDate.setMonth(nextDate.getMonth() - amount);
    return nextDate;
  }

  if (unit === "year") {
    nextDate.setFullYear(nextDate.getFullYear() - amount);
    return nextDate;
  }

  return null;
}

function normalizeRelativeTimestamp(value, referenceDate = new Date()) {
  const text = normalizeLinkedinTimestampText(value).toLowerCase();

  if (!text) {
    return null;
  }

  const patterns = [
    { regex: /^(\d+)\s*min(?:\b|uto|minutos)?/, unit: "minute" },
    { regex: /^(\d+)\s*h(?:\b|ora|oras)?/, unit: "hour" },
    { regex: /^(\d+)\s*d(?:\b|ia|ias)?/, unit: "day" },
    { regex: /^(\d+)\s*sem(?:\b|ana|anas)?/, unit: "week" },
    { regex: /^(\d+)\s*m\b/, unit: "month" },
    { regex: /^(\d+)\s*m[eê]s(?:es)?/, unit: "month" },
    { regex: /^(\d+)\s*ano(?:s)?/, unit: "year" }
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern.regex);

    if (!match) {
      continue;
    }

    const amount = Number(match[1]);

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const normalizedDate = subtractFromDate(referenceDate, amount, pattern.unit);
    return normalizedDate ? normalizedDate.toISOString() : null;
  }

  return null;
}

function inferPostType(candidate) {
  if (candidate.hasVideo) {
    return "video";
  }

  if (candidate.hasDocument) {
    return "document";
  }

  if (candidate.hasArticleLink) {
    return "article";
  }

  if (candidate.hasImage) {
    return "image";
  }

  return "text";
}

function hashContent(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function buildPostKey(post) {
  const url = normalizeUrl(post.url);
  const urlUrn = extractActivityUrn(url);

  if (urlUrn) {
    return urlUrn;
  }

  if (url) {
    return url;
  }

  if (post.urn && !isEphemeralUrn(post.urn)) {
    return post.urn;
  }

  return `text:${hashContent([post.text, post.publishedAtText, post.type].filter(Boolean).join("|"))}`;
}

export function resolveSyncRunOptions({ maxScrolls, fullScan = false, enrichAll = false } = {}) {
  const parsedMaxScrolls = Number(maxScrolls);
  const safeMaxScrolls = Number.isFinite(parsedMaxScrolls)
    ? Math.max(0, parsedMaxScrolls)
    : (fullScan ? DEFAULT_FULL_SCAN_MAX_SCROLLS : DEFAULT_MAX_SCROLLS);

  return {
    safeMaxScrolls,
    enrichLimit: enrichAll ? Number.POSITIVE_INFINITY : (fullScan ? 0 : PERMALINK_ENRICH_LIMIT)
  };
}

export function selectPostsForEnrichment(posts, existingPostKeys = new Set()) {
  const selectedPosts = [];
  const seenPostKeys = new Set(existingPostKeys);

  for (const post of posts || []) {
    const postKey = buildPostKey(post);

    if (!postKey || seenPostKeys.has(postKey)) {
      continue;
    }

    seenPostKeys.add(postKey);
    selectedPosts.push(post);
  }

  return selectedPosts;
}

function parseMetricFromText(text, patterns) {
  const normalizedText = normalizeVisibleText(text);

  if (!normalizedText) {
    return null;
  }

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);

    if (match) {
      return normalizeMetricCount(match[1]);
    }
  }

  return null;
}

function parseCommentsCount(text) {
  const normalizedText = normalizeVisibleText(text);

  if (/seja a primeira pessoa a comentar|be the first to comment/i.test(normalizedText)) {
    return 0;
  }

  return parseMetricFromText(normalizedText, [
    /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?)(?:\s+|\b)(?:comment|comments|coment|coment[aá]rios?)/i
  ]);
}

function parseRepostsCount(text) {
  return parseMetricFromText(text, [
    /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?)(?:\s+|\b)(?:repost|republi|share|compartilh)/i
  ]);
}

function sanitizeMetricRawText(text) {
  const normalizedText = normalizeVisibleText(text);

  if (!normalizedText) {
    return null;
  }

  const segments = [];
  const reactionSummaryMatch = normalizedText.match(/(?:.+?\s+)?(?:mais\s+\d+\s+pessoas\s+reagiram|and\s+\d+\s+others\s+reacted)/i);

  if (reactionSummaryMatch) {
    segments.push(normalizeVisibleText(reactionSummaryMatch[0]));
  }

  const patterns = [
    /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?\s*(?:reactions?|reac(?:oes|ões)?|curtidas?|likes?)(?:\b|$)/gi,
    /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?\s*(?:comments?|coment[aá]rios?)(?:\b|$)/gi,
    /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?\s*(?:reposts?|compartilhamentos?)(?:\b|$)/gi,
    /(?:^|\s)\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?\s*(?:impressions?|impress(?:oes|ões)?)(?:\b|$)/gi,
    /seja a primeira pessoa a comentar/gi,
    /be the first to comment/gi
  ];

  for (const pattern of patterns) {
    const matches = normalizedText.match(pattern) || [];

    for (const match of matches) {
      const cleanedMatch = normalizeVisibleText(match);

      if (cleanedMatch) {
        segments.push(cleanedMatch);
      }
    }
  }

  const uniqueSegments = [...new Set(segments)];

  return uniqueSegments.length > 0 ? uniqueSegments.join(" | ") : normalizedText;
}

function buildPostExcerpt(text, maxLength = 180) {
  const normalizedText = normalizeVisibleText(text);

  if (normalizedText.length <= maxLength) {
    return normalizedText || null;
  }

  return `${normalizedText.slice(0, maxLength - 1).trim()}...`;
}

function normalizeScrapedPost(candidate, { referenceDate = new Date() } = {}) {
  const text = normalizeVisibleText(candidate.text);
  const url = normalizeUrl(candidate.url);
  const candidateUrn = normalizeVisibleText(candidate.urn) || null;
  const activityUrn = extractActivityUrn(url) || extractActivityUrn(candidateUrn);
  const publishedAtText = normalizeVisibleText(candidate.publishedAtText);
  const publishedAt =
    normalizeTimestamp(candidate.publishedAt) ||
    normalizeTimestamp(publishedAtText) ||
    normalizeRelativeTimestamp(publishedAtText, referenceDate);
  const metricText = sanitizeMetricRawText(candidate.metricText || candidate.metrics?.rawText);
  const resolvedUrl = url || buildCanonicalLinkedinPostUrl(activityUrn);
  const existingMetrics = candidate.metrics || {};
  const post = {
    postKey: "",
    urn: activityUrn || (isEphemeralUrn(candidateUrn) ? null : candidateUrn),
    url: resolvedUrl,
    text,
    publishedAt,
    publishedAtText: publishedAtText || null,
    type: inferPostType(candidate),
    metrics: {
      rawText: metricText || null,
      reactions: parseReactionSummaryCount(metricText) || parseMetricFromText(metricText, [
        /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?)(?:\s+|\b)(?:reaction|reac|curtid|like)/i,
        /(?:^|\s)(\d+(?:[.,]\d+)?\s*(?:k|m|mil|mi)?)(?:\s+|\b)(?:impression|view)/i
      ]) || existingMetrics.reactions || null,
      comments: parseCommentsCount(metricText),
      reposts: parseRepostsCount(metricText)
    },
    media: {
      hasImage: Boolean(candidate.hasImage),
      hasVideo: Boolean(candidate.hasVideo),
      hasDocument: Boolean(candidate.hasDocument),
      hasArticleLink: Boolean(candidate.hasArticleLink)
    },
    source: "linkedin_browser"
  };

  if (!Number.isFinite(post.metrics.comments) && Number.isFinite(existingMetrics.comments)) {
    post.metrics.comments = existingMetrics.comments;
  }

  if (!Number.isFinite(post.metrics.reposts) && Number.isFinite(existingMetrics.reposts)) {
    post.metrics.reposts = existingMetrics.reposts;
  }

  post.postKey = buildPostKey(post);

  return post;
}

function selectPreferredValue(currentValue, nextValue) {
  return normalizeVisibleText(nextValue || "") || currentValue || null;
}

function selectPreferredNumber(currentValue, nextValue) {
  if (Number.isFinite(nextValue)) {
    return nextValue;
  }

  return Number.isFinite(currentValue) ? currentValue : null;
}

function mergePostRecord(existingPost, incomingPost, seenAt) {
  const mergedPost = {
    ...existingPost,
    ...incomingPost,
    url: incomingPost.url || existingPost?.url || null,
    urn: incomingPost.urn || existingPost?.urn || null,
    text: selectPreferredValue(existingPost?.text, incomingPost.text),
    publishedAt: incomingPost.publishedAt || existingPost?.publishedAt || null,
    publishedAtText: selectPreferredValue(existingPost?.publishedAtText, incomingPost.publishedAtText),
    type: incomingPost.type || existingPost?.type || "text",
    source: "linkedin_browser",
    media: {
      hasImage: Boolean(incomingPost.media?.hasImage || existingPost?.media?.hasImage),
      hasVideo: Boolean(incomingPost.media?.hasVideo || existingPost?.media?.hasVideo),
      hasDocument: Boolean(incomingPost.media?.hasDocument || existingPost?.media?.hasDocument),
      hasArticleLink: Boolean(incomingPost.media?.hasArticleLink || existingPost?.media?.hasArticleLink)
    },
    metrics: {
      rawText: selectPreferredValue(existingPost?.metrics?.rawText, incomingPost.metrics?.rawText),
      reactions: selectPreferredNumber(existingPost?.metrics?.reactions, incomingPost.metrics?.reactions),
      comments: selectPreferredNumber(existingPost?.metrics?.comments, incomingPost.metrics?.comments),
      reposts: selectPreferredNumber(existingPost?.metrics?.reposts, incomingPost.metrics?.reposts)
    },
    firstSeenAt: existingPost?.firstSeenAt || seenAt,
    lastSeenAt: seenAt
  };

  mergedPost.postKey = buildPostKey(mergedPost);

  return mergedPost;
}

function hasMeaningfulChanges(previousPost, nextPost) {
  return JSON.stringify({
    url: previousPost.url || null,
    text: previousPost.text || null,
    publishedAt: previousPost.publishedAt || null,
    publishedAtText: previousPost.publishedAtText || null,
    type: previousPost.type || null,
    metrics: previousPost.metrics || null,
    media: previousPost.media || null
  }) !== JSON.stringify({
    url: nextPost.url || null,
    text: nextPost.text || null,
    publishedAt: nextPost.publishedAt || null,
    publishedAtText: nextPost.publishedAtText || null,
    type: nextPost.type || null,
    metrics: nextPost.metrics || null,
    media: nextPost.media || null
  });
}

function isStablePostIdentity(post) {
  return Boolean(extractActivityUrn(post?.urn) || extractActivityUrn(post?.url));
}

function buildEphemeralDuplicateKey(post) {
  const text = normalizeVisibleText(post?.text);

  if (!text) {
    return null;
  }

  const publishedAtText = normalizeVisibleText(post?.publishedAtText);
  const publishedAt = normalizeVisibleText(post?.publishedAt);

  return [post?.type || "text", text, publishedAt || publishedAtText].join("|");
}

function mergeDuplicatePosts(primaryPost, duplicatePost) {
  const firstSeenAtCandidates = [primaryPost?.firstSeenAt, duplicatePost?.firstSeenAt].filter(Boolean).sort();
  const lastSeenAtCandidates = [primaryPost?.lastSeenAt, duplicatePost?.lastSeenAt].filter(Boolean).sort();

  return {
    ...duplicatePost,
    ...primaryPost,
    postKey: primaryPost.postKey,
    urn: primaryPost.urn || duplicatePost?.urn || null,
    url: primaryPost.url || duplicatePost?.url || null,
    text: selectPreferredValue(duplicatePost?.text, primaryPost?.text),
    publishedAt: primaryPost.publishedAt || duplicatePost?.publishedAt || null,
    publishedAtText: selectPreferredValue(duplicatePost?.publishedAtText, primaryPost?.publishedAtText),
    type: primaryPost.type || duplicatePost?.type || "text",
    metrics: {
      rawText: selectPreferredValue(duplicatePost?.metrics?.rawText, primaryPost?.metrics?.rawText),
      reactions: selectPreferredNumber(duplicatePost?.metrics?.reactions, primaryPost?.metrics?.reactions),
      comments: selectPreferredNumber(duplicatePost?.metrics?.comments, primaryPost?.metrics?.comments),
      reposts: selectPreferredNumber(duplicatePost?.metrics?.reposts, primaryPost?.metrics?.reposts)
    },
    media: {
      hasImage: Boolean(primaryPost?.media?.hasImage || duplicatePost?.media?.hasImage),
      hasVideo: Boolean(primaryPost?.media?.hasVideo || duplicatePost?.media?.hasVideo),
      hasDocument: Boolean(primaryPost?.media?.hasDocument || duplicatePost?.media?.hasDocument),
      hasArticleLink: Boolean(primaryPost?.media?.hasArticleLink || duplicatePost?.media?.hasArticleLink)
    },
    firstSeenAt: firstSeenAtCandidates[0] || null,
    lastSeenAt: lastSeenAtCandidates.at(-1) || null,
    source: "linkedin_browser"
  };
}

function dedupeEphemeralPosts(posts) {
  const stablePostsByDuplicateKey = new Map();

  for (const post of posts) {
    if (!isStablePostIdentity(post)) {
      continue;
    }

    const duplicateKey = buildEphemeralDuplicateKey(post);

    if (duplicateKey) {
      stablePostsByDuplicateKey.set(duplicateKey, post);
    }
  }

  const dedupedPosts = [];

  for (const post of posts) {
    const duplicateKey = buildEphemeralDuplicateKey(post);
    const matchingStablePost = duplicateKey ? stablePostsByDuplicateKey.get(duplicateKey) : null;

    if (matchingStablePost && matchingStablePost.postKey !== post.postKey && !isStablePostIdentity(post)) {
      const mergedStablePost = mergeDuplicatePosts(matchingStablePost, post);
      stablePostsByDuplicateKey.set(duplicateKey, mergedStablePost);
      continue;
    }

    if (matchingStablePost && matchingStablePost.postKey === post.postKey) {
      dedupedPosts.push(stablePostsByDuplicateKey.get(duplicateKey) || post);
      continue;
    }

    dedupedPosts.push(post);
  }

  return dedupedPosts;
}

function sortPosts(posts) {
  return posts.sort((left, right) => {
    const leftPublishedAt = left.publishedAt || "";
    const rightPublishedAt = right.publishedAt || "";

    if (leftPublishedAt && rightPublishedAt) {
      const publishedAtComparison = String(rightPublishedAt).localeCompare(String(leftPublishedAt));

      if (publishedAtComparison !== 0) {
        return publishedAtComparison;
      }
    }

    if (leftPublishedAt) {
      return -1;
    }

    if (rightPublishedAt) {
      return 1;
    }

    const leftFallback = left.firstSeenAt || left.lastSeenAt || "";
    const rightFallback = right.firstSeenAt || right.lastSeenAt || "";
    return String(rightFallback).localeCompare(String(leftFallback));
  });
}

export function mergeSyncPosts(existingPosts, incomingPosts, { seenAt = new Date().toISOString() } = {}) {
  const postsByKey = new Map();
  let newCount = 0;
  let updatedCount = 0;
  const referenceDate = new Date(seenAt);

  for (const post of existingPosts || []) {
    postsByKey.set(post.postKey, post);
  }

  for (const rawPost of incomingPosts || []) {
    const incomingPost = normalizeScrapedPost(rawPost, { referenceDate });

    if (!incomingPost.text && !incomingPost.url) {
      continue;
    }

    const existingPost = postsByKey.get(incomingPost.postKey);
    const mergedPost = mergePostRecord(existingPost, incomingPost, seenAt);

    if (!existingPost) {
      newCount += 1;
    } else if (hasMeaningfulChanges(existingPost, mergedPost)) {
      updatedCount += 1;
    }

    postsByKey.set(mergedPost.postKey, mergedPost);
  }

  return {
    posts: sortPosts(dedupeEphemeralPosts([...postsByKey.values()])),
    newCount,
    updatedCount
  };
}

export async function listLinkedinSyncPosts({
  appConfig = config,
  localState = createLocalState(appConfig),
  limit,
  query,
  includeRawMetrics = false
} = {}) {
  const postsStore = await localState.loadSyncPostsStore();
  const normalizedQuery = normalizeVisibleText(query || "").toLowerCase();
  const parsedLimit = Number(limit);
  const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null;

  const filteredPosts = postsStore.posts.filter((post) => {
    if (!normalizedQuery) {
      return true;
    }

    const haystack = [post.text, post.publishedAtText, post.url, post.urn, post.type]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });

  const visiblePosts = safeLimit ? filteredPosts.slice(0, safeLimit) : filteredPosts;

  return {
    totalStoredPosts: postsStore.posts.length,
    returnedPosts: visiblePosts.length,
    query: normalizedQuery || null,
    posts: visiblePosts.map((post) => ({
      postKey: post.postKey,
      urn: post.urn,
      url: post.url,
      type: post.type,
      publishedAt: post.publishedAt,
      publishedAtText: post.publishedAtText,
      excerpt: buildPostExcerpt(post.text),
      metrics: includeRawMetrics
        ? post.metrics
        : {
            reactions: post.metrics?.reactions ?? null,
            comments: post.metrics?.comments ?? null,
            reposts: post.metrics?.reposts ?? null
          },
      media: post.media,
      firstSeenAt: post.firstSeenAt,
      lastSeenAt: post.lastSeenAt
    }))
  };
}

async function isLoginRequired(page) {
  const currentUrl = page.url();

  if (/linkedin\.com\/(?:login|checkpoint|uas\/login|authwall)/i.test(currentUrl)) {
    return true;
  }

  const loginFormCount = await page
    .locator("input[name='session_key'], input[name='session_password'], form[action*='login']")
    .count();

  return loginFormCount > 0;
}

async function waitForManualLogin(page, { timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});

    if (!(await isLoginRequired(page))) {
      return true;
    }
  }

  return false;
}

async function openDirectLoginPage(page) {
  await page.goto(LINKEDIN_DIRECT_LOGIN_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.bringToFront().catch(() => {});
}

async function enrichPostFromPermalink(page, post) {
  const permalinkUrl = post.url || buildCanonicalLinkedinPostUrl(post.urn);

  if (!permalinkUrl) {
    return post;
  }

  await page.goto(permalinkUrl, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

  if (await isLoginRequired(page)) {
    throw buildFailure(
      "browser_login_required",
      "A sessao do LinkedIn expirou durante o enriquecimento por permalink. Conclua o login manualmente no Chromium e rode a sincronizacao novamente."
    );
  }

  const enrichedData = await page.evaluate(() => {
    const normalizeText = (value) => {
      if (typeof value !== "string") {
        return "";
      }

      return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    };

    const bodyText = normalizeText(document.body?.innerText || "");
    const permalinkLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((link) => ({
        href: link.href || "",
        text: normalizeText(link.textContent || ""),
        aria: normalizeText(link.getAttribute("aria-label") || "")
      }))
      .filter((item) => item.href.includes("/feed/update/") || item.href.includes("/recent-activity/") || item.href.includes("/posts/") || item.href.includes("/analytics/post-summary/"));

    const publishedAtText = [
      ...document.querySelectorAll(
        "time, .update-components-actor__sub-description span[aria-hidden='true'], .feed-shared-actor__sub-description span[aria-hidden='true'], .update-components-actor__sub-description, .feed-shared-actor__sub-description"
      )
    ]
      .map((element) => normalizeText(element.getAttribute("datetime") || element.textContent || ""))
      .find(Boolean) || "";

    const metricSegments = [];

    for (const link of permalinkLinks) {
      if (link.text) {
        metricSegments.push(link.text);
      }

      if (link.aria) {
        metricSegments.push(link.aria);
      }
    }

    const reactionMatch = bodyText.match(/[^.]{0,80}mais\s+\d+\s+pessoas\s+reagiram[^.]{0,40}/i);
    const commentsMatch = bodyText.match(/seja a primeira pessoa a comentar|\d+\s+coment[aá]rios?/i);
    const repostsMatch = bodyText.match(/\d+\s+compartilhamentos?/i);

    if (reactionMatch) {
      metricSegments.push(reactionMatch[0]);
    }

    if (commentsMatch) {
      metricSegments.push(commentsMatch[0]);
    }

    if (repostsMatch) {
      metricSegments.push(repostsMatch[0]);
    }

    const permalink = permalinkLinks.find((item) => item.href.includes("/feed/update/") || item.href.includes("/posts/"))?.href || window.location.href;

    const fallbackMetricText = bodyText;

    return {
      url: permalink,
      publishedAtText,
      metricText: normalizeText(metricSegments.join(" ")) || fallbackMetricText || null
    };
  });

  return normalizeScrapedPost(
    {
      ...post,
      url: enrichedData.url || permalinkUrl,
      publishedAtText: enrichedData.publishedAtText || post.publishedAtText,
      metricText: enrichedData.metricText || post.metrics?.rawText || null
    },
    { referenceDate: new Date() }
  );
}

async function enrichVisiblePosts(browserContext, posts, { enrichLimit = PERMALINK_ENRICH_LIMIT } = {}) {
  const enrichablePosts = posts.filter((post) => post.url || post.urn);
  const selectedPosts = Number.isFinite(enrichLimit)
    ? enrichablePosts.slice(0, enrichLimit)
    : enrichablePosts;

  if (selectedPosts.length === 0) {
    return posts;
  }

  const page = await browserContext.newPage();

  try {
    const enrichedPosts = [];

    for (const post of selectedPosts) {
      enrichedPosts.push(await enrichPostFromPermalink(page, post));
    }

    const enrichedByKey = new Map(enrichedPosts.map((post) => [post.postKey, post]));

    return posts.map((post) => enrichedByKey.get(post.postKey) || post);
  } finally {
    await page.close().catch(() => {});
  }
}

async function extractVisiblePosts(page) {
  const scrapedPosts = await page.evaluate(() => {
    const normalizeText = (value) => {
      if (typeof value !== "string") {
        return "";
      }

      return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    };

    const findText = (root, selectors) => {
      for (const selector of selectors) {
        const element = root.querySelector(selector);

        if (element) {
          const value = normalizeText(element.getAttribute("datetime") || element.textContent || "");

          if (value) {
            return value;
          }
        }
      }

      return "";
    };

    const extractMetricText = (root) => {
      const selectors = [
        ".social-details-social-counts",
        ".social-details-social-counts__reactions-count",
        ".social-details-social-counts__comments",
        ".update-v2-social-activity",
        "[class*='social-details']",
        "[aria-label*='reaction' i]",
        "[aria-label*='comment' i]",
        "[aria-label*='repost' i]",
        "[aria-label*='compartilh' i]",
        "[aria-label*='coment' i]",
        "[aria-label*='curtid' i]"
      ];

      const parts = [];

      for (const selector of selectors) {
        for (const element of root.querySelectorAll(selector)) {
          const value = normalizeText(element.getAttribute("aria-label") || element.textContent || "");

          if (value) {
            parts.push(value);
          }
        }
      }

      const metricText = normalizeText(parts.join(" "));

      if (metricText) {
        return metricText;
      }

      return normalizeText(root.innerText || root.textContent || "");
    };

    const extractPublishedAtText = (root) => {
      return findText(root, [
        "time",
        "a[href*='/recent-activity/'] span[aria-hidden='true']",
        "a[href*='/recent-activity/']",
        "a[href*='/feed/update/'] span[aria-hidden='true']",
        "a[href*='/feed/update/']",
        ".update-components-actor__sub-description span[aria-hidden='true']",
        ".feed-shared-actor__sub-description span[aria-hidden='true']",
        ".update-components-actor__sub-description",
        ".feed-shared-actor__sub-description"
      ]);
    };

    const extractPermalink = (root) => {
      const links = Array.from(root.querySelectorAll("a[href]"));

      for (const link of links) {
        const href = link.href || "";

        if (
          href.includes("/feed/update/") ||
          href.includes("/posts/") ||
          href.includes("/pulse/") ||
          href.includes("/recent-activity/")
        ) {
          return href;
        }
      }

      return "";
    };

    const cards = Array.from(document.querySelectorAll("div.feed-shared-update-v2, div.occludable-update, article"));
    const posts = [];

    for (const card of cards) {
      const timeElement = card.querySelector("time");
      const text = findText(card, [
        ".update-components-update-v2__commentary",
        ".update-components-text-view",
        ".feed-shared-update-v2__description-wrapper",
        ".feed-shared-inline-show-more-text",
        ".update-components-text",
        ".break-words",
        "[data-test-id='main-feed-activity-card__commentary']"
      ]);
      const metricText = extractMetricText(card);
      const publishedAtText = extractPublishedAtText(card);
      const urnRoot = card.closest("[data-urn]") || card;

      posts.push({
        urn: normalizeText(urnRoot?.getAttribute("data-urn") || card.getAttribute("data-id") || card.id || ""),
        url: extractPermalink(card),
        text,
        publishedAt: timeElement?.getAttribute("datetime") || "",
        publishedAtText,
        metricText,
        hasImage: Boolean(card.querySelector("img[src*='media'], img[alt*='Image'], .update-components-image")),
        hasVideo: Boolean(card.querySelector("video, [aria-label*='video' i]")),
        hasDocument: Boolean(card.querySelector("a[href*='/document/'], [aria-label*='document' i]")),
        hasArticleLink: Boolean(card.querySelector("a[href*='/pulse/'], a[href*='article']"))
      });
    }

    return posts;
  });

  return scrapedPosts
    .map((post) => normalizeScrapedPost(post))
    .filter((post) => post.text || post.url);
}

async function scrollFeed(page) {
  const beforeScroll = await page.evaluate(() => ({
    height: document.body.scrollHeight,
    y: window.scrollY
  }));

  await page.evaluate(() => {
    window.scrollBy(0, Math.max(window.innerHeight, 900));
  });
  await page.waitForTimeout(1200);
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});

  const afterScroll = await page.evaluate(() => ({
    height: document.body.scrollHeight,
    y: window.scrollY
  }));

  return afterScroll.height > beforeScroll.height || afterScroll.y > beforeScroll.y;
}

function buildFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function getLinkedinSyncStatus({
  appConfig = config,
  localState = createLocalState(appConfig)
} = {}) {
  const [postsStore, syncState] = await Promise.all([
    localState.loadSyncPostsStore(),
    localState.loadSyncState()
  ]);

  let browserProfilePresent = false;

  try {
    const stats = await fs.stat(appConfig.browserProfileDirPath);
    browserProfilePresent = stats.isDirectory();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    startUrl: syncState.lastStartUrl || appConfig.linkedinSyncStartUrl,
    browserProfilePath: appConfig.browserProfileDirPath,
    browserProfilePresent,
    syncDirPath: appConfig.syncDirPath,
    postsFilePath: appConfig.syncPostsFilePath,
    stateFilePath: appConfig.syncStateFilePath,
    totalStoredPosts: postsStore.posts.length,
    lastRunAt: syncState.lastRunAt,
    lastSuccessfulRunAt: syncState.lastSuccessfulRunAt,
    lastStopReason: syncState.lastStopReason,
    lastError: syncState.lastError
  };
}

export async function runLinkedinBrowserSync({
  appConfig = config,
  localState = createLocalState(appConfig),
  startUrl = appConfig.linkedinSyncStartUrl,
  headless = false,
  maxScrolls = DEFAULT_MAX_SCROLLS,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
  fullScan = false,
  enrichAll = false
} = {}) {
  const syncState = await localState.loadSyncState();
  const postsStore = await localState.loadSyncPostsStore();
  const startedAt = new Date().toISOString();
  let browserContext;

  try {
    const { chromium } = await import("playwright");

    await fs.mkdir(appConfig.browserProfileDirPath, { recursive: true });

    browserContext = await chromium.launchPersistentContext(appConfig.browserProfileDirPath, {
      headless,
      viewport: null,
      args: [
        `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
        "--window-position=40,40"
      ]
    });

    const page = browserContext.pages()[0] || (await browserContext.newPage());

    await page.goto(startUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45000
    });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    if (await isLoginRequired(page)) {
      if (headless) {
        throw buildFailure(
          "browser_login_required",
          "A sessao do LinkedIn no perfil persistente do navegador nao esta autenticada. Execute o sync sem headless, conclua o login manualmente no Chromium e tente novamente."
        );
      }

      await openDirectLoginPage(page);

      const loginCompleted = await waitForManualLogin(page, { timeoutMs: loginTimeoutMs });

      if (!loginCompleted) {
        throw buildFailure(
          "browser_login_required",
          "A sessao do LinkedIn no perfil persistente do navegador nao foi autenticada a tempo. Conclua o login manualmente no Chromium e rode a sincronizacao novamente."
        );
      }

      await page.goto(startUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000
      });
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

      if (await isLoginRequired(page)) {
        throw buildFailure(
          "browser_login_required",
          "A sessao do LinkedIn ainda nao ficou autenticada no perfil persistente do navegador. Conclua o login manualmente e rode a sincronizacao novamente."
        );
      }
    }

    const knownPostKeys = new Set(syncState.knownPostKeys || []);
    const scrapedPosts = new Map();
    const { safeMaxScrolls, enrichLimit } = resolveSyncRunOptions({
      maxScrolls,
      fullScan,
      enrichAll
    });
    let stopReason = "max_scrolls_reached";

    for (let scrollIndex = 0; scrollIndex <= safeMaxScrolls; scrollIndex += 1) {
      const extractedVisiblePosts = await extractVisiblePosts(page);
      const postsToEnrich = selectPostsForEnrichment(extractedVisiblePosts, new Set(scrapedPosts.keys()));
      const visiblePosts = await enrichVisiblePosts(
        browserContext,
        postsToEnrich,
        { enrichLimit }
      );

      for (const visiblePost of visiblePosts) {
        scrapedPosts.set(visiblePost.postKey, visiblePost);
      }

      if (extractedVisiblePosts.length === 0 && scrollIndex === 0) {
        stopReason = "no_posts_visible";
        break;
      }

      if (!fullScan && knownPostKeys.size > 0 && extractedVisiblePosts.some((post) => knownPostKeys.has(buildPostKey(post))) && scrapedPosts.size > 0) {
        stopReason = "reached_known_post";
        break;
      }

      if (scrollIndex === safeMaxScrolls) {
        break;
      }

      const moved = await scrollFeed(page);

      if (!moved) {
        stopReason = scrapedPosts.size > 0 ? "end_of_page" : "no_posts_visible";
        break;
      }
    }

    const finishedAt = new Date().toISOString();
    const mergeResult = mergeSyncPosts(postsStore.posts, [...scrapedPosts.values()], { seenAt: finishedAt });
    const nextState = {
      version: 1,
      lastRunAt: startedAt,
      lastSuccessfulRunAt: finishedAt,
      lastStartUrl: startUrl,
      lastStopReason: stopReason,
      lastError: null,
      knownPostKeys: mergeResult.posts.slice(0, KNOWN_POST_KEYS_LIMIT).map((post) => post.postKey),
      totalPosts: mergeResult.posts.length
    };

    await localState.saveSyncPostsStore({ posts: mergeResult.posts });
    await localState.saveSyncState(nextState);

    return {
      ok: true,
      fullScan,
      enrichAll,
      startUrl,
      startedAt,
      finishedAt,
      stopReason,
      scrapedCount: scrapedPosts.size,
      newPosts: mergeResult.newCount,
      updatedPosts: mergeResult.updatedCount,
      totalStoredPosts: mergeResult.posts.length,
      postsFilePath: appConfig.syncPostsFilePath,
      stateFilePath: appConfig.syncStateFilePath,
      browserProfilePath: appConfig.browserProfileDirPath
    };
  } catch (error) {
    await localState.saveSyncState({
      ...syncState,
      lastRunAt: startedAt,
      lastStartUrl: startUrl,
      lastStopReason: "failed",
      lastError: {
        code: error.code || "sync_failed",
        message: error.message,
        timestamp: startedAt
      }
    }).catch(() => {});

    throw error;
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
  }
}

export async function resolvePersonUrnFromProfileUrl({
  profileUrl,
  appConfig = config,
  headless = true,
  timeoutMs = 30000
} = {}) {
  if (!profileUrl || typeof profileUrl !== "string") {
    throw buildFailure("invalid_profile_url", "A URL do perfil LinkedIn e obrigatoria.");
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(profileUrl);
  } catch {
    throw buildFailure("invalid_profile_url", `URL invalida: ${profileUrl}`);
  }

  if (
    parsedUrl.hostname !== "www.linkedin.com" &&
    parsedUrl.hostname !== "linkedin.com"
  ) {
    throw buildFailure("invalid_profile_url", `URL nao e do LinkedIn: ${profileUrl}`);
  }

  const pathMatch = parsedUrl.pathname.match(/^\/in\/([^/]+)/);

  if (!pathMatch) {
    throw buildFailure("invalid_profile_url", `URL nao e de perfil LinkedIn (/in/...): ${profileUrl}`);
  }

  let browserContext;

  try {
    const { chromium } = await import("playwright");

    await fs.mkdir(appConfig.browserProfileDirPath, { recursive: true });

    browserContext = await chromium.launchPersistentContext(appConfig.browserProfileDirPath, {
      headless,
      viewport: null,
      args: [
        `--window-size=${DEFAULT_BROWSER_WINDOW_WIDTH},${DEFAULT_BROWSER_WINDOW_HEIGHT}`,
        "--window-position=40,40"
      ]
    });

    const page = browserContext.pages()[0] || (await browserContext.newPage());

    // Intercept network responses to capture urn:li:person: from LinkedIn API calls
    const capturedUrns = new Map(); // urn -> Set of source URLs

    page.on("response", async (response) => {
      try {
        const url = response.url();
        if (!url.includes("linkedin.com")) return;
        if (response.status() < 200 || response.status() >= 300) return;
        const body = await response.text();
        const normalized = body.replace(/%3A/gi, ":");
        // Capture all LinkedIn URN formats
        const urnRegex = /urn:li:(person|member|fsd_profile|fs_miniProfile):([A-Za-z0-9_-]+)/g;
        for (const m of normalized.matchAll(urnRegex)) {
          const urn = m[0];
          if (!capturedUrns.has(urn)) capturedUrns.set(urn, new Set());
          capturedUrns.get(urn).add(url.split("?")[0]);
        }
      } catch {
        // Ignore responses that can't be read
      }
    });

    await page.goto(profileUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (await isLoginRequired(page)) {
      throw buildFailure(
        "browser_login_required",
        "A sessao do LinkedIn no perfil persistente do navegador nao esta autenticada. Execute o sync sem headless, conclua o login manualmente no Chromium e tente novamente."
      );
    }

    // Check network-captured URNs first
    if (capturedUrns.size > 0) {
      // Prefer urn:li:person: for REST Posts API mentions
      const personUrns = [...capturedUrns.keys()].filter(u => u.startsWith("urn:li:person:"));
      if (personUrns.length > 0) {
        return {
          personUrn: personUrns[0],
          profileUrl,
          resolvedFrom: "network_person",
          allCaptured: Object.fromEntries([...capturedUrns.entries()].map(([k, v]) => [k, [...v]]))
        };
      }
      // Return debug info about what was captured
      const debugUrns = Object.fromEntries([...capturedUrns.entries()].map(([k, v]) => [k, [...v]]));
      // Don't return yet — fall through to HTML parsing, but attach network debug info
      var _networkDebug = debugUrns;
    }

    const pageContent = await page.content();

    // LinkedIn may URL-encode URNs in the page (%3A instead of :)
    const normalizedContent = pageContent.replace(/%3A/gi, ":");

    // Prefer urn:li:person: (required for REST Posts API mentions)
    const personMatch = normalizedContent.match(/urn:li:person:([A-Za-z0-9_-]+)/);

    if (personMatch) {
      return {
        personUrn: personMatch[0],
        profileUrl,
        resolvedFrom: "person"
      };
    }

    const fsdMatch = normalizedContent.match(/urn:li:fsd_profile:([A-Za-z0-9_-]+)/)
      || normalizedContent.match(/fsd_profile:([A-Za-z0-9_-]+)/);

    if (fsdMatch) {
      const fsdId = fsdMatch[1];
      const fsdBytes = Buffer.from(fsdId, "base64url");
      if (fsdBytes.length >= 8) {
        const numericMemberId = fsdBytes.readUInt32BE(4);
        return {
          personUrn: `urn:li:member:${numericMemberId}`,
          profileUrl,
          resolvedFrom: "fsd_profile",
          ...(typeof _networkDebug !== "undefined" && { networkUrns: _networkDebug })
        };
      }
      return {
        personUrn: `urn:li:member:${fsdId}`,
        profileUrl,
        resolvedFrom: "fsd_profile"
      };
    }

    const memberMatch = normalizedContent.match(/urn:li:member:([A-Za-z0-9_-]+)/);

    if (memberMatch) {
      return {
        personUrn: memberMatch[0],
        profileUrl,
        resolvedFrom: "member"
      };
    }

    throw buildFailure(
      "urn_not_found",
      `Nao foi possivel extrair o URN do perfil: ${profileUrl}. Verifique se o perfil existe e se a sessao do navegador esta autenticada.`
    );
  } finally {
    if (browserContext) {
      await browserContext.close();
    }
  }
}