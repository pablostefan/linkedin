import dotenv from "dotenv";

dotenv.config();

function requireEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:3000",
  sessionSecret: requireEnv("SESSION_SECRET"),
  linkedinClientId: requireEnv("LINKEDIN_CLIENT_ID"),
  linkedinClientSecret: requireEnv("LINKEDIN_CLIENT_SECRET"),
  linkedinRedirectUri: requireEnv("LINKEDIN_REDIRECT_URI"),
  linkedinApiVersion: process.env.LINKEDIN_API_VERSION || "202504",
  linkedinScopes: (process.env.LINKEDIN_SCOPES || "openid profile email w_member_social")
    .split(/\s+/)
    .filter(Boolean)
};