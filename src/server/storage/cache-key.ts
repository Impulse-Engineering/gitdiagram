import { createHmac } from "node:crypto";

import {
  hasGitHubAppAuth,
  readGitHubInstallationId,
} from "~/server/github-auth";
import type { ArtifactVisibility } from "~/server/storage/types";
import { readRequiredEnv } from "~/server/storage/config";

function normalizeSegment(value: string): string {
  return encodeURIComponent(value.trim().toLowerCase());
}

function createPatNamespace(githubPat: string): string {
  const trimmedPat = githubPat.trim();
  // An empty token would hash to one fixed namespace shared by every caller,
  // and no read path ever consults it (getReadLocations only reaches the
  // private bucket when a token is present). Fail loudly instead of writing
  // artifacts nobody can read back.
  if (!trimmedPat) {
    throw new Error(
      "A private storage location requires a non-empty GitHub token.",
    );
  }

  const secret = readRequiredEnv("CACHE_KEY_SECRET");
  return createHmac("sha256", secret).update(trimmedPat).digest("hex");
}

function createAppNamespace(): string {
  const installationId = readGitHubInstallationId();
  if (!installationId || !hasGitHubAppAuth()) {
    throw new Error(
      "A private storage location requires a non-empty GitHub token.",
    );
  }

  const secret = readRequiredEnv("CACHE_KEY_SECRET");
  return createHmac("sha256", secret)
    .update(`github-app:${installationId}`)
    .digest("hex");
}

export interface StorageLocation {
  visibility: ArtifactVisibility;
  bucket: string;
  artifactKey: string;
  statusKey: string;
}

export function getPublicPreviewKey(username: string, repo: string): string {
  // The sidecar lives under its own prefix rather than a ".preview" suffix on
  // the repo segment: normalizeSegment leaves "." unescaped, so a suffix would
  // let the sidecar for repo "app" collide with the artifact for the legal
  // repo name "app.preview" and silently overwrite it.
  return `public-preview/v1/${normalizeSegment(username)}/${normalizeSegment(repo)}.json`;
}

export function getPublicLocation(
  username: string,
  repo: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);

  return {
    visibility: "public",
    bucket: readRequiredEnv("R2_PUBLIC_BUCKET"),
    artifactKey: `public/v1/${normalizedUsername}/${normalizedRepo}.json`,
    statusKey: `status:v1:public:${normalizedUsername}:${normalizedRepo}`,
  };
}

function privateLocationForNamespace(
  username: string,
  repo: string,
  namespace: string,
): StorageLocation {
  const normalizedUsername = normalizeSegment(username);
  const normalizedRepo = normalizeSegment(repo);

  return {
    visibility: "private",
    bucket: readRequiredEnv("R2_PRIVATE_BUCKET"),
    artifactKey: `private/v1/${namespace}/${normalizedUsername}/${normalizedRepo}.json`,
    statusKey: `status:v1:private:${namespace}:${normalizedUsername}:${normalizedRepo}`,
  };
}

export function getPrivateLocation(
  username: string,
  repo: string,
  githubPat: string,
): StorageLocation {
  return privateLocationForNamespace(
    username,
    repo,
    createPatNamespace(githubPat),
  );
}

export function getPrivateAppLocation(
  username: string,
  repo: string,
): StorageLocation {
  return privateLocationForNamespace(username, repo, createAppNamespace());
}

/**
 * Resolves where a generation result should be written.
 *
 * A private artifact is namespaced by the caller's own token when present.
 * With a GitHub App installation configured, private results without a caller
 * PAT go to a stable App namespace (installation id, not the rotating ghs_
 * token). The public bucket must never receive a private diagram. Callers
 * must handle the remaining case before reaching storage —
 * `canPersistVisibility` answers the same question without throwing.
 */
export function getWriteLocation(params: {
  username: string;
  repo: string;
  visibility: ArtifactVisibility;
  githubPat?: string;
}): StorageLocation {
  if (params.visibility !== "private") {
    return getPublicLocation(params.username, params.repo);
  }

  if (params.githubPat?.trim()) {
    return getPrivateLocation(params.username, params.repo, params.githubPat);
  }

  return getPrivateAppLocation(params.username, params.repo);
}

export function canPersistVisibility(params: {
  visibility: ArtifactVisibility;
  githubPat?: string;
}): boolean {
  return (
    params.visibility !== "private" ||
    Boolean(params.githubPat?.trim()) ||
    hasGitHubAppAuth()
  );
}

export function getReadLocations(params: {
  username: string;
  repo: string;
  githubPat?: string;
}): StorageLocation[] {
  const locations: StorageLocation[] = [];
  if (params.githubPat?.trim()) {
    locations.push(
      getPrivateLocation(params.username, params.repo, params.githubPat),
    );
  }
  if (hasGitHubAppAuth()) {
    locations.push(getPrivateAppLocation(params.username, params.repo));
  }
  locations.push(getPublicLocation(params.username, params.repo));
  return locations;
}
