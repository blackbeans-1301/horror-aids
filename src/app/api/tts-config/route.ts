import path from 'node:path';

import { NextResponse } from 'next/server';

import { readJsonFile, writeJsonFile } from '@/lib/json-store';
import { configRoot } from '@/lib/paths';

interface AppConfig {
  omnivoice?: {
    model?: string;
    device?: string;
    gguf?: { binary?: string; modelPath?: string; codecPath?: string; steps?: number };
  };
  whisper?: { enabled?: boolean; [key: string]: unknown };
  audio?: { sampleRate?: number; channels?: number };
  segmentation?: { charactersEnabled?: boolean };
  [key: string]: unknown;
}

const configPath = path.join(configRoot, 'app.json');

const GGUF_MODEL_ID = 'Serveurperso/OmniVoice-GGUF-BF16';
const GGUF_DEFAULT_STEPS = 32;
const GGUF_MIN_STEPS = 4;
const GGUF_MAX_STEPS = 32;

const MODELS = [
  { id: 'k2-fsa/OmniVoice', label: 'OmniVoice', supportsDevice: true },
  {
    id: GGUF_MODEL_ID,
    label: 'OmniVoice GGUF (BF16, native omnivoice.cpp)',
    supportsDevice: false,
  },
];
const DEVICES = [
  { id: 'auto', label: 'Auto-detect' },
  { id: 'cpu', label: 'CPU' },
  { id: 'mps', label: 'Apple Silicon (MPS)' },
  { id: 'cuda', label: 'NVIDIA GPU (CUDA)' },
];

function toResponseShape(config: AppConfig) {
  const model = config.omnivoice?.model || 'k2-fsa/OmniVoice';
  const device = config.omnivoice?.device || 'auto';
  const modelEntry = MODELS.find((entry) => entry.id === model);
  return {
    model,
    modelLabel: modelEntry?.label ?? model,
    modelRepo: model,
    models: MODELS,
    device,
    devices: DEVICES,
    sampleRate: config.audio?.sampleRate ?? 22050,
    voicesDir: 'data/voices',
    verificationEnabled: config.whisper?.enabled ?? false,
    characterSegmentationEnabled: config.segmentation?.charactersEnabled ?? true,
    ggufSteps: config.omnivoice?.gguf?.steps ?? GGUF_DEFAULT_STEPS,
    ggufStepsRange: { min: GGUF_MIN_STEPS, max: GGUF_MAX_STEPS, default: GGUF_DEFAULT_STEPS },
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
    characterSegmentationEnabled?: unknown;
    ggufSteps?: unknown;
  };
  const device = typeof body.device === 'string' ? body.device : undefined;
  const model = typeof body.model === 'string' ? body.model : undefined;
  const verificationEnabled =
    typeof body.verificationEnabled === 'boolean' ? body.verificationEnabled : undefined;
  const characterSegmentationEnabled =
    typeof body.characterSegmentationEnabled === 'boolean'
      ? body.characterSegmentationEnabled
      : undefined;
  const ggufSteps =
    typeof body.ggufSteps === 'number' && Number.isFinite(body.ggufSteps)
      ? Math.round(Math.min(GGUF_MAX_STEPS, Math.max(GGUF_MIN_STEPS, body.ggufSteps)))
      : undefined;
  if (
    !device &&
    !model &&
    verificationEnabled === undefined &&
    characterSegmentationEnabled === undefined &&
    ggufSteps === undefined
  ) {
    return NextResponse.json(
      {
        error:
          'model, device, verificationEnabled, characterSegmentationEnabled, or ggufSteps is required',
      },
      { status: 400 },
    );
  }

  const config = await readJsonFile<AppConfig>(configPath, {});
  const nextConfig: AppConfig = {
    ...config,
    omnivoice: {
      ...config.omnivoice,
      model: model ?? config.omnivoice?.model ?? 'k2-fsa/OmniVoice',
      device: device ?? config.omnivoice?.device ?? 'auto',
      gguf: {
        ...config.omnivoice?.gguf,
        steps: ggufSteps ?? config.omnivoice?.gguf?.steps ?? GGUF_DEFAULT_STEPS,
      },
    },
    whisper: {
      ...config.whisper,
      enabled: verificationEnabled ?? config.whisper?.enabled ?? false,
    },
    segmentation: {
      ...config.segmentation,
      charactersEnabled: characterSegmentationEnabled ?? config.segmentation?.charactersEnabled ?? true,
    },
  };
  await writeJsonFile(configPath, nextConfig);
  return NextResponse.json(toResponseShape(nextConfig));
}
