// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canPersistVisibility,
  getPrivateAppLocation,
  getPrivateLocation,
  getPublicLocation,
  getPublicPreviewKey,
  getReadLocations,
  getWriteLocation,
} from "~/server/storage/cache-key";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.CACHE_KEY_SECRET = "test-cache-key-secret";
  process.env.R2_PUBLIC_BUCKET = "public-bucket";
  process.env.R2_PRIVATE_BUCKET = "private-bucket";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("private namespace", () => {
  it("separates callers by their own token", () => {
    const first = getPrivateLocation("acme", "demo", "token-one");
    const second = getPrivateLocation("acme", "demo", "token-two");

    expect(first.artifactKey).not.toBe(second.artifactKey);
    expect(first.bucket).toBe("private-bucket");
  });

  it("refuses an empty token instead of writing to a shared namespace", () => {
    // Hashing "" yields one fixed namespace for every caller, and no read path
    // ever consults it, so an artifact written there is silently unreachable.
    expect(() => getPrivateLocation("acme", "demo", "")).toThrow(
      /non-empty GitHub token/u,
    );
    expect(() => getPrivateLocation("acme", "demo", "   ")).toThrow(
      /non-empty GitHub token/u,
    );
  });
});

describe("getPublicPreviewKey", () => {
  it("lives in a namespace no artifact key can reach", () => {
    // Dots are legal in repo names and survive normalization, so the sidecar
    // for repo "app" must never share a key with the artifact for repo
    // "app.preview" — that collision let a preview write destroy an artifact.
    expect(getPublicPreviewKey("acme", "app")).not.toBe(
      getPublicLocation("acme", "app.preview").artifactKey,
    );
    expect(getPublicPreviewKey("acme", "app")).toBe(
      "public-preview/v1/acme/app.json",
    );
    expect(getPublicPreviewKey("acme", "app")).not.toMatch(/^public\//u);
  });
});

describe("getWriteLocation", () => {
  it("sends public results to the public bucket", () => {
    expect(
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "public",
      }).bucket,
    ).toBe("public-bucket");
  });

  it("throws for a private result the caller did not authenticate for", () => {
    expect(() =>
      getWriteLocation({
        username: "acme",
        repo: "demo",
        visibility: "private",
      }),
    ).toThrow(/non-empty GitHub token/u);
  });

  it("writes App-backed private results to a stable installation namespace", () => {
    process.env.GITHUB_PRIVATE_KEY = "test-pem";
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_INSTALLATION_ID = "456";

    const first = getWriteLocation({
      username: "acme",
      repo: "demo",
      visibility: "private",
    });
    const second = getWriteLocation({
      username: "acme",
      repo: "demo",
      visibility: "private",
    });
    const withCallerPat = getWriteLocation({
      username: "acme",
      repo: "demo",
      visibility: "private",
      githubPat: "caller-token",
    });

    expect(first.artifactKey).toBe(second.artifactKey);
    expect(first.artifactKey).toBe(
      getPrivateAppLocation("acme", "demo").artifactKey,
    );
    expect(first.artifactKey).not.toBe(withCallerPat.artifactKey);
    expect(first.bucket).toBe("private-bucket");
  });
});

describe("canPersistVisibility", () => {
  it("mirrors the destinations getWriteLocation can actually resolve", () => {
    expect(canPersistVisibility({ visibility: "public" })).toBe(true);
    expect(
      canPersistVisibility({ visibility: "private", githubPat: "token" }),
    ).toBe(true);
    expect(canPersistVisibility({ visibility: "private" })).toBe(false);
    expect(
      canPersistVisibility({ visibility: "private", githubPat: "  " }),
    ).toBe(false);
  });

  it("allows private persistence when a GitHub App installation is configured", () => {
    process.env.GITHUB_PRIVATE_KEY = "test-pem";
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_INSTALLATION_ID = "456";

    expect(canPersistVisibility({ visibility: "private" })).toBe(true);
  });
});

describe("getReadLocations", () => {
  it("never reaches the private bucket without a token", () => {
    const locations = getReadLocations({ username: "acme", repo: "demo" });

    expect(locations).toHaveLength(1);
    expect(locations[0]?.visibility).toBe("public");
  });

  it("prefers the caller's private namespace, then falls back to public", () => {
    const locations = getReadLocations({
      username: "acme",
      repo: "demo",
      githubPat: "token",
    });

    expect(locations.map((location) => location.visibility)).toEqual([
      "private",
      "public",
    ]);
  });

  it("reads the App private namespace without a caller token", () => {
    process.env.GITHUB_PRIVATE_KEY = "test-pem";
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_INSTALLATION_ID = "456";

    const locations = getReadLocations({ username: "acme", repo: "demo" });

    expect(locations.map((location) => location.visibility)).toEqual([
      "private",
      "public",
    ]);
    expect(locations[0]?.artifactKey).toBe(
      getPrivateAppLocation("acme", "demo").artifactKey,
    );
  });

  it("prefers the caller PAT namespace, then the App namespace, then public", () => {
    process.env.GITHUB_PRIVATE_KEY = "test-pem";
    process.env.GITHUB_APP_ID = "123";
    process.env.GITHUB_INSTALLATION_ID = "456";

    const locations = getReadLocations({
      username: "acme",
      repo: "demo",
      githubPat: "token",
    });

    expect(locations.map((location) => location.artifactKey)).toEqual([
      getPrivateLocation("acme", "demo", "token").artifactKey,
      getPrivateAppLocation("acme", "demo").artifactKey,
      getPublicLocation("acme", "demo").artifactKey,
    ]);
  });
});
