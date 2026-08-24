// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";

import {
  getGitHubApiHeaders,
  hasGitHubAppAuth,
  readGitHubInstallationId,
  readGitHubPatPool,
} from "~/server/github-auth";

const originalGithubPat = process.env.GITHUB_PAT;
const originalGithubPats = process.env.GITHUB_PATS;
const originalGithubPrivateKey = process.env.GITHUB_PRIVATE_KEY;
const originalGithubAppId = process.env.GITHUB_APP_ID;
const originalGithubClientId = process.env.GITHUB_CLIENT_ID;
const originalGithubInstallationId = process.env.GITHUB_INSTALLATION_ID;

afterEach(() => {
  if (originalGithubPat === undefined) delete process.env.GITHUB_PAT;
  else process.env.GITHUB_PAT = originalGithubPat;
  if (originalGithubPats === undefined) delete process.env.GITHUB_PATS;
  else process.env.GITHUB_PATS = originalGithubPats;
  if (originalGithubPrivateKey === undefined)
    delete process.env.GITHUB_PRIVATE_KEY;
  else process.env.GITHUB_PRIVATE_KEY = originalGithubPrivateKey;
  if (originalGithubAppId === undefined) delete process.env.GITHUB_APP_ID;
  else process.env.GITHUB_APP_ID = originalGithubAppId;
  if (originalGithubClientId === undefined) delete process.env.GITHUB_CLIENT_ID;
  else process.env.GITHUB_CLIENT_ID = originalGithubClientId;
  if (originalGithubInstallationId === undefined) {
    delete process.env.GITHUB_INSTALLATION_ID;
  } else {
    process.env.GITHUB_INSTALLATION_ID = originalGithubInstallationId;
  }
});

describe("readGitHubPatPool", () => {
  it("uses a standalone GITHUB_PAT and deduplicates pooled tokens", () => {
    process.env.GITHUB_PAT = "single";
    process.env.GITHUB_PATS = "pooled, single\npooled";

    expect(readGitHubPatPool()).toEqual(["pooled", "single"]);
  });

  it("does not drop GITHUB_PAT when GITHUB_PATS is unset", () => {
    process.env.GITHUB_PAT = "single";
    delete process.env.GITHUB_PATS;

    expect(readGitHubPatPool()).toEqual(["single"]);
  });

  it("round-robins the fallback PAT pool", async () => {
    delete process.env.GITHUB_PAT;
    process.env.GITHUB_PATS = "first,second";

    const headers = await Promise.all([
      getGitHubApiHeaders({ allowGitHubAppAuth: false }),
      getGitHubApiHeaders({ allowGitHubAppAuth: false }),
      getGitHubApiHeaders({ allowGitHubAppAuth: false }),
    ]);

    expect(headers.map((value) => value.Authorization)).toEqual([
      "Bearer first",
      "Bearer second",
      "Bearer first",
    ]);
  });

  it("keeps an explicit request PAT ahead of the fallback pool", async () => {
    process.env.GITHUB_PATS = "fallback";

    await expect(
      getGitHubApiHeaders({
        githubPat: "request-token",
        allowGitHubAppAuth: false,
      }),
    ).resolves.toMatchObject({
      Authorization: "Bearer request-token",
    });
  });
});

describe("hasGitHubAppAuth", () => {
  it("requires private key, issuer, and installation id", () => {
    delete process.env.GITHUB_PRIVATE_KEY;
    delete process.env.GITHUB_APP_ID;
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_INSTALLATION_ID;

    expect(hasGitHubAppAuth()).toBe(false);

    process.env.GITHUB_PRIVATE_KEY = "pem";
    process.env.GITHUB_APP_ID = "1";
    expect(hasGitHubAppAuth()).toBe(false);

    process.env.GITHUB_INSTALLATION_ID = "99";
    expect(hasGitHubAppAuth()).toBe(true);
    expect(readGitHubInstallationId()).toBe("99");
  });
});
