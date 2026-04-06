import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const envFilePath = path.resolve(currentDirPath, "../.env");

dotenv.config({ path: envFilePath });

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  port: 3901,
  serverHost: "127.0.0.1",
  appBaseUrl: "http://localhost:3901",
  authUrl: "http://localhost:3901/auth/linkedin",
  sessionSecret: requireEnv("SESSION_SECRET"),
  linkedinClientId: requireEnv("LINKEDIN_CLIENT_ID"),
  linkedinClientSecret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  linkedinRedirectUri: process.env.LINKEDIN_REDIRECT_URI || "http://localhost:3901/auth/linkedin/callback",
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || "202504",
  linkedinScopes: (process.env.LINKEDIN_SCOPES || "openid profile email w_member_social")
    .split(/\s+/)
    .filter(Boolean),
  localDataDir: path.resolve(currentDirPath, "../.local/linkedin"),
  authFilePath: path.resolve(currentDirPath, "../.local/linkedin/auth.json"),
  draftsFilePath: path.resolve(currentDirPath, "../.local/linkedin/drafts.json"),
  draftsBackupFilePath: path.resolve(currentDirPath, "../.local/linkedin/drafts.backup.json"),
  publishHistoryFilePath: path.resolve(currentDirPath, "../.local/linkedin/publish-history.jsonl"),
  publishIntentTtlMs: Number(process.env.PUBLISH_INTENT_TTL_MS || 10 * 60 * 1000)
};