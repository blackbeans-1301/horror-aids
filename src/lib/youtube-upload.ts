import 'server-only';

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { google } from 'googleapis';
import type { Credentials, OAuth2Client } from 'google-auth-library';

import {
  patchStory,
  readStory,
  readVideoPlanOrDefaults,
  readYoutubeMetadataOrDefault,
} from '@/lib/json-store';
import { resolveStoryPath, youtubeTokenPath } from '@/lib/paths';

// videos.insert covers upload; thumbnails.set also only needs this one scope
// (no separate "youtube" scope required) — see the YouTube Data API v3 docs.
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} chưa được cấu hình — thêm vào .env.local trước khi dùng YouTube upload.`);
  }
  return value;
}

// Not deployed anywhere public — this app only ever runs on localhost, so the
// OAuth redirect URI is fixed to whatever port it's serving on, overridable
// for the rare case that isn't 3000 (see build.sh's PORT).
function redirectUri(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    `http://localhost:${process.env.PORT ?? '3000'}/api/youtube/oauth/callback`
  );
}

function createOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    requireEnv('GOOGLE_OAUTH_CLIENT_ID'),
    requireEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri(),
  );
}

export function buildYoutubeAuthUrl(): string {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    // Forces Google to reissue a refresh_token even for an account that
    // already granted consent once before — otherwise a reconnect after
    // disconnectYoutube() would silently come back with no refresh_token.
    prompt: 'consent',
    scope: SCOPES,
  });
}

async function readTokens(): Promise<Credentials | null> {
  try {
    const raw = await fs.readFile(youtubeTokenPath, 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

async function writeTokens(tokens: Credentials): Promise<void> {
  await fs.mkdir(path.dirname(youtubeTokenPath), { recursive: true });
  await fs.writeFile(youtubeTokenPath, JSON.stringify(tokens, null, 2), 'utf8');
}

export async function exchangeYoutubeAuthCode(code: string): Promise<void> {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  // A refresh_token is only ever handed back on the consent leg — merge onto
  // whatever's already on disk so a later token refresh (which returns only
  // a fresh access_token) never overwrites/erases it.
  const existing = await readTokens();
  await writeTokens({ ...existing, ...tokens });
}

export async function disconnectYoutube(): Promise<void> {
  await fs.rm(youtubeTokenPath, { force: true });
}

export async function getYoutubeConnectionStatus(): Promise<{
  connected: boolean;
  channelTitle: string | null;
}> {
  const tokens = await readTokens();
  if (!tokens?.refresh_token) {
    return { connected: false, channelTitle: null };
  }
  try {
    const client = createOAuthClient();
    client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: client });
    const response = await youtube.channels.list({ part: ['snippet'], mine: true });
    return { connected: true, channelTitle: response.data.items?.[0]?.snippet?.title ?? null };
  } catch {
    // Still "connected" (a refresh token is on disk) even if this particular
    // status probe failed — an expired/revoked token surfaces properly the
    // next time an actual upload is attempted, with a clearer error there.
    return { connected: true, channelTitle: null };
  }
}

async function getAuthorizedClient(): Promise<OAuth2Client> {
  const tokens = await readTokens();
  if (!tokens?.refresh_token) {
    throw new Error('YouTube chưa được kết nối — vào Settings để đăng nhập tài khoản YouTube trước.');
  }
  const client = createOAuthClient();
  client.setCredentials(tokens);
  // The googleapis client refreshes the access token transparently as
  // needed; persist whatever it refreshes to so the next call (possibly in a
  // different process) doesn't have to re-auth from scratch.
  client.on('tokens', (fresh) => {
    void writeTokens({ ...tokens, ...fresh });
  });
  return client;
}

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

// Uploads a story's approved final video to YouTube (private by default —
// see the operator's answer in the feature request this shipped from) and
// sets the story's intro image as its thumbnail. Best-effort from the
// caller's point of view: failures are recorded on story.youtube instead of
// thrown further, mirroring how generateYoutubeMetadata records its own
// failures — the operator can retry from the Metadata tab.
export async function uploadFinalVideoForStory(slug: string): Promise<void> {
  const story = await readStory(slug);
  const videoAbsolutePath = resolveStoryPath(slug, story.video.finalPath);
  if (!(await fileExists(videoAbsolutePath))) {
    throw new Error('Final video file is missing on disk; render/select a final video first.');
  }

  await patchStory(slug, (current) => ({
    ...current,
    youtube: { ...current.youtube, status: 'uploading', error: null },
  }));

  try {
    const [videoPlan, metadata] = await Promise.all([
      readVideoPlanOrDefaults(slug),
      readYoutubeMetadataOrDefault(slug),
    ]);
    const thumbnailPath = videoPlan.introImagePath
      ? resolveStoryPath(slug, videoPlan.introImagePath)
      : null;
    const title = metadata.titles[metadata.selectedTitleIndex] ?? metadata.titles[0] ?? story.title;
    const description = metadata.renderedDescription || story.title;

    const auth = await getAuthorizedClient();
    const youtube = google.youtube({ version: 'v3', auth });

    const insertResponse = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title: title.slice(0, 100),
          description,
          tags: metadata.tags,
          // Entertainment — closest built-in YouTube category to horror
          // narration; there's no dedicated "horror story" category.
          categoryId: '24',
        },
        status: {
          privacyStatus: 'private',
          selfDeclaredMadeForKids: false,
        },
      },
      media: {
        body: fsSync.createReadStream(videoAbsolutePath),
      },
    });

    const videoId = insertResponse.data.id;
    if (!videoId) {
      throw new Error('YouTube did not return a videoId after upload.');
    }

    if (thumbnailPath && (await fileExists(thumbnailPath))) {
      await youtube.thumbnails.set({
        videoId,
        media: { body: fsSync.createReadStream(thumbnailPath) },
      });
    }

    await patchStory(slug, (current) => ({
      ...current,
      youtube: {
        videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        status: 'uploaded',
        uploadedAt: new Date().toISOString(),
        error: null,
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'YouTube upload failed';
    await patchStory(slug, (current) => ({
      ...current,
      youtube: { ...current.youtube, status: 'failed', error: message },
    }));
    throw error;
  }
}
