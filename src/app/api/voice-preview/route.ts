import 'server-only';

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { readJsonFile, readVoices } from '@/lib/json-store';
import { configRoot, projectRoot, pythonExecutable, voicePreviewCacheRoot, workersRoot } from '@/lib/paths';

const SAMPLE_TEXT =
  'Đêm đó, trời mưa tầm tã. Tiếng gõ cửa vang lên từ căn nhà hoang cuối ngõ.';

function previewCachePath(voiceId: string, model: string, device: string): string {
  const safeModel = model.replace(/[^a-zA-Z0-9_-]+/g, '_');
  const safeDevice = device.replace(/[^a-zA-Z0-9_-]+/g, '_');
  return path.join(voicePreviewCacheRoot, `${voiceId}__${safeModel}__${safeDevice}.wav`);
}

interface OmnivoiceAppConfig {
  omnivoice?: { model?: string; device?: string };
}

function runPreview(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), args, { cwd: projectRoot, env: process.env });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `preview_voice exited with code ${code}`));
      }
    });
  });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const voiceId = url.searchParams.get('voice');
  if (!voiceId) {
    return NextResponse.json({ error: 'voice query param is required' }, { status: 400 });
  }

  const { voices } = await readVoices();
  const voice = voices.find((entry) => entry.id === voiceId);
  if (!voice) {
    return NextResponse.json({ error: `Unknown voice: ${voiceId}` }, { status: 404 });
  }

  const config = await readJsonFile<OmnivoiceAppConfig>(path.join(configRoot, 'app.json'), {});
  const model = process.env.OMNIVOICE_MODEL || config.omnivoice?.model || 'k2-fsa/OmniVoice';
  const device = process.env.OMNIVOICE_DEVICE || config.omnivoice?.device || 'auto';

  const cachePath = previewCachePath(voiceId, model, device);
  const cached = await fs.readFile(cachePath).catch(() => null);
  if (cached) {
    return new NextResponse(cached, {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
    });
  }

  const outputPath = path.join(os.tmpdir(), `horror-aids-preview-${randomUUID()}.wav`);
  const scriptPath = path.join(workersRoot, 'preview_voice.py');

  try {
    await runPreview([
      scriptPath,
      '--voice-wav',
      path.join(projectRoot, voice.wavPath),
      '--text',
      SAMPLE_TEXT,
      '--output',
      outputPath,
      '--model',
      model,
      '--device',
      device,
      '--config',
      path.join(configRoot, 'app.json'),
    ]);
    const audio = await fs.readFile(outputPath);
    await fs.mkdir(voicePreviewCacheRoot, { recursive: true });
    await fs.writeFile(cachePath, audio);
    return new NextResponse(audio, {
      headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voice preview failed' },
      { status: 502 },
    );
  } finally {
    await fs.unlink(outputPath).catch(() => undefined);
  }
}
