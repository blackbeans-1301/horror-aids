import path from 'node:path';

import { NextResponse } from 'next/server';

import { readJsonFile, writeJsonFile } from '@/lib/json-store';
import { configRoot } from '@/lib/paths';

interface AppConfig {
  omnivoice?: { model?: string; device?: string };
  whisper?: { enabled?: boolean; [key: string]: unknown };
  audio?: { sampleRate?: number; channels?: number };
  [key: string]: unknown;
}

const configPath = path.join(configRoot, 'app.json');

const MODELS = [{ id: 'k2-fsa/OmniVoice', label: 'OmniVoice' }];
const DEVICES = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'cpu', label: 'CPU' },
  { id: 'mps', label: 'Apple Silicon (MPS)' },
  { id: 'cuda', label: 'NVIDIA GPU (CUDA)' },
];

function toResponseShape(config: AppConfig) {
  const model = config.omnivoice?.model || 'k2-fsa/OmniVoice';
  const device = config.omnivoice?.device || 'auto';
  return {
    model,
    modelLabel: MODELS.find((entry) => entry.id === model)?.label ?? model,
    modelRepo: model,
    models: MODELS,
    device,
    devices: DEVICES,
    sampleRate: config.audio?.sampleRate ?? 22050,
    emotions: [] as string[],
    inlineCues: [] as string[],
    voicesDir: 'data/voices',
    verificationEnabled: config.whisper?.enabled ?? true,
    notes:
      'Local OmniVoice model — voice cloning only, no live server. Model/device changes ' +
      'apply the next time you preview a voice or run "Generate and verify audio" ' +
      '(first real run downloads model weights from Hugging Face).',
  };
}

export async function GET(): Promise<NextResponse> {
  const config = await readJsonFile<AppConfig>(configPath, {});
  return NextResponse.json(toResponseShape(config));
}

export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as {
    device?: unknown;
    model?: unknown;
    verificationEnabled?: unknown;
  };
  const device = typeof body.device === 'string' ? body.device : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  const verificationEnabled =
    typeof body.verificationEnabled === 'boolean' ? body.verificationEnabled : undefined;
  if (!device && !model && verificationEnabled === undefined) {
    return NextResponse.json(
      { error: 'model, device, or verificationEnabled is required' },
      { status: 400 },
    );
  }

  const config = await readJsonFile<AppConfig>(configPath, {});
  const nextConfig: AppConfig = {
    ...config,
    omnivoice: {
      model: model ?? config.omnivoice?.model ?? 'k2-fsa/OmniVoice',
      device: device ?? config.omnivoice?.device ?? 'auto',
    },
    whisper: {
      ...config.whisper,
      enabled: verificationEnabled ?? config.whisper?.enabled ?? true,
    },
  };
  await writeJsonFile(configPath, nextConfig);
  return NextResponse.json(toResponseShape(nextConfig));
}
