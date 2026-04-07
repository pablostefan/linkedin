import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";

describe("config", () => {
  it("exports required file paths", () => {
    assert.ok(config.localDataDir);
    assert.ok(config.draftsFilePath);
    assert.ok(config.draftsBackupFilePath);
    assert.ok(config.publishHistoryFilePath);
  });

  it("exports zernio account id", () => {
    assert.equal(config.zernioAccountId, "69d527827dea335c2bc20f6f");
  });

  it("exports zernio organization urn", () => {
    assert.equal(config.zernioOrganizationUrn, "urn:li:organization:112832146");
  });

  it("exports publish intent TTL as a positive number", () => {
    assert.equal(typeof config.publishIntentTtlMs, "number");
    assert.ok(config.publishIntentTtlMs > 0);
  });

  it("paths resolve to .local/linkedin directory", () => {
    assert.ok(config.draftsFilePath.includes(".local/linkedin"));
    assert.ok(config.publishHistoryFilePath.includes(".local/linkedin"));
  });
});
