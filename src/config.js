import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

const localDataDir = process.env.LOCAL_DATA_DIR || path.resolve(currentDirPath, "../.local/linkedin");

export const config = {
  localDataDir,
  draftsFilePath: path.join(localDataDir, "drafts.json"),
  draftsBackupFilePath: path.join(localDataDir, "drafts.backup.json"),
  publishHistoryFilePath: path.join(localDataDir, "publish-history.jsonl"),
  publishIntentTtlMs: Number(process.env.PUBLISH_INTENT_TTL_MS || 10 * 60 * 1000),
  zernioAccountId: "69d527827dea335c2bc20f6f",
  zernioOrganizationUrn: "urn:li:organization:112832146"
};