'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mic, Play, RefreshCw, Trash2, Upload, Youtube } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { storiesApi, type VoiceOption } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';

interface TtsConfig {
  model: string;
  modelLabel: string;
  modelRepo: string;
  models: Array<{ id: string; label: string; supportsDevice: boolean }>;
  device: string;
  devices: Array<{ id: string; label: string }>;
  sampleRate: number;
  voicesDir: string;
  verificationEnabled: boolean;
  characterSegmentationEnabled: boolean;
  ggufSteps: number;
  ggufStepsRange: { min: number; max: number; default: number };
  error?: string;
}

async function wavFileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const SettingsClient: React.FC = () => {
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [configError, setConfigError] = useState<string>('');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [message, setMessage] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [voiceName, setVoiceName] = useState<string>('');
  const [previewVoiceId, setPreviewVoiceId] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('k2-fsa/OmniVoice');
  const [selectedDevice, setSelectedDevice] = useState<string>('auto');
  const [selectedVerificationEnabled, setSelectedVerificationEnabled] = useState<boolean>(true);
  const [selectedCharacterSegmentationEnabled, setSelectedCharacterSegmentationEnabled] =
    useState<boolean>(true);
  const [selectedGgufSteps, setSelectedGgufSteps] = useState<number>(32);
  const [replaceVoiceId, setReplaceVoiceId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceFileInputRef = useRef<HTMLInputElement | null>(null);
  const confirm = useConfirm();
  const router = useRouter();
  const [youtubeStatus, setYoutubeStatus] = useState<{
    connected: boolean;
    channelTitle: string | null;
  } | null>(null);
  const [youtubeBusy, setYoutubeBusy] = useState<boolean>(false);

  const refreshYoutubeStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/youtube/status');
      const data = (await response.json()) as { connected: boolean; channelTitle: string | null };
      setYoutubeStatus(data);
    } catch {
      setYoutubeStatus({ connected: false, channelTitle: null });
    }
  }, []);

  useEffect(() => {
    void refreshYoutubeStatus();
  }, [refreshYoutubeStatus]);

  // The OAuth callback redirects back here with ?youtube=connected|error —
  // surface it once as a toast, then strip the query string so a page
  // refresh doesn't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('youtube');
    if (!result) {
      return;
    }
    if (result === 'connected') {
      toast.success('Đã kết nối tài khoản YouTube.');
      void refreshYoutubeStatus();
    } else {
      toast.error(`Kết nối YouTube thất bại: ${params.get('youtubeError') ?? 'unknown error'}`);
    }
    router.replace('/settings');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnectYoutubeAccount = useCallback(async (): Promise<void> => {
    setYoutubeBusy(true);
    try {
      const response = await fetch('/api/youtube/disconnect', { method: 'POST' });
      if (!response.ok) {
        throw new Error('Disconnect failed');
      }
      toast.success('Đã ngắt kết nối YouTube.');
      await refreshYoutubeStatus();
    } catch {
      toast.error('Không thể ngắt kết nối YouTube.');
    } finally {
      setYoutubeBusy(false);
    }
  }, [refreshYoutubeStatus]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await storiesApi.voices();
      setVoices(data.voices);
      if (data.voices.length === 0 && data.error) {
        setMessage(data.error);
      }
    } catch {
      setMessage('Could not load voices.');
    }

    try {
      const response = await fetch('/api/tts-config');
      const data = (await response.json()) as TtsConfig;
      if (response.ok) {
        setConfig(data);
        setSelectedModel(data.model);
        setSelectedDevice(data.device);
        setSelectedVerificationEnabled(data.verificationEnabled);
        setSelectedCharacterSegmentationEnabled(data.characterSegmentationEnabled);
        setSelectedGgufSteps(data.ggufSteps);
        setConfigError('');
      } else {
        setConfig(null);
        setConfigError(data.error ?? 'Could not load TTS config.');
      }
    } catch {
      setConfig(null);
      setConfigError('Could not reach the app server.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep the replace-audio target selector pointed at a real voice — falls
  // back to the first one once voices load, and re-picks if the previously
  // selected voice is deleted.
  useEffect(() => {
    if (voices.length === 0) {
      setReplaceVoiceId('');
      return;
    }
    if (!voices.some((voice) => voice.id === replaceVoiceId)) {
      setReplaceVoiceId(voices[0].id);
    }
  }, [voices, replaceVoiceId]);

  // Each settings panel applies (and is gated by) only its own fields — a
  // shared single dirty-flag/apply used to mean clicking Apply in any one
  // panel silently committed whatever was pending in the other two as well.
  const hasModelPendingChanges =
    config !== null &&
    (selectedModel !== config.model ||
      selectedDevice !== config.device ||
      selectedGgufSteps !== config.ggufSteps);
  const hasVerificationPendingChanges =
    config !== null && selectedVerificationEnabled !== config.verificationEnabled;
  const hasSegmentationPendingChanges =
    config !== null && selectedCharacterSegmentationEnabled !== config.characterSegmentationEnabled;

  const postConfig = useCallback(
    async (body: {
      model?: string;
      device?: string;
      verificationEnabled?: boolean;
      characterSegmentationEnabled?: boolean;
      ggufSteps?: number;
    }): Promise<TtsConfig> => {
      const response = await fetch('/api/tts-config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as TtsConfig & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Save failed');
      }
      setConfig(data);
      setSelectedModel(data.model);
      setSelectedDevice(data.device);
      setSelectedVerificationEnabled(data.verificationEnabled);
      setSelectedCharacterSegmentationEnabled(data.characterSegmentationEnabled);
      setSelectedGgufSteps(data.ggufSteps);
      return data;
    },
    [],
  );

  const applyModelSettings = useCallback(async (): Promise<void> => {
    if (!config) {
      return;
    }
    const switchingModel = selectedModel !== config.model;
    const body: { model?: string; device?: string; ggufSteps?: number } = switchingModel
      ? { model: selectedModel }
      : { device: selectedDevice };
    if (selectedGgufSteps !== config.ggufSteps) {
      body.ggufSteps = selectedGgufSteps;
    }

    setIsBusy(true);
    try {
      const data = await postConfig(body);
      toast.success(
        `Saved — ${data.modelLabel} on ${data.device.toUpperCase()} will be used for the next ` +
          'preview or generation run (first real run downloads the model, which can take a while).',
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [config, postConfig, refresh, selectedDevice, selectedGgufSteps, selectedModel]);

  const applyVerificationSetting = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    try {
      const data = await postConfig({ verificationEnabled: selectedVerificationEnabled });
      toast.success(`Audio verification is ${data.verificationEnabled ? 'ON' : 'OFF'}.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [postConfig, refresh, selectedVerificationEnabled]);

  const applySegmentationSetting = useCallback(async (): Promise<void> => {
    setIsBusy(true);
    try {
      const data = await postConfig({
        characterSegmentationEnabled: selectedCharacterSegmentationEnabled,
      });
      toast.success(`Character segmentation is ${data.characterSegmentationEnabled ? 'ON' : 'OFF'}.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [postConfig, refresh, selectedCharacterSegmentationEnabled]);

  const replaceVoiceAudio = useCallback(async (): Promise<void> => {
    const voice = voices.find((entry) => entry.id === replaceVoiceId);
    if (!voice) {
      toast.error('Choose a voice to replace first.');
      return;
    }
    const file = replaceFileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a WAV file first.');
      return;
    }

    const confirmed = await confirm({
      title: 'Replace reference audio?',
      description:
        `Overwrite the reference clip for "${voice.description}" with this new WAV. The old ` +
        'clip is gone permanently — there is no other copy. Any cached transcript/preview for ' +
        'this voice is cleared so it regenerates from the new audio.',
      confirmLabel: 'Replace',
      danger: true,
    });
    if (!confirmed) {
      return;
    }

    setIsBusy(true);
    try {
      const wavBase64 = await wavFileToBase64(file);
      const response = await fetch(`/api/voices/${encodeURIComponent(replaceVoiceId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wavBase64 }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Could not replace voice audio');
      }
      toast.success(`Replaced reference audio for "${voice.description}".`);
      if (replaceFileInputRef.current) {
        replaceFileInputRef.current.value = '';
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not replace voice audio');
    } finally {
      setIsBusy(false);
    }
  }, [confirm, refresh, replaceVoiceId, voices]);

  const uploadVoice = useCallback(async (): Promise<void> => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose a WAV file first.');
      return;
    }
    if (!voiceName.trim()) {
      toast.error('Give the voice a name first.');
      return;
    }

    setIsBusy(true);
    try {
      const wavBase64 = await wavFileToBase64(file);
      const response = await fetch('/api/voices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: voiceName, wavBase64 }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Upload failed');
      }
      toast.success(`Voice ${data.id} is ready to use in the Characters tab.`);
      setVoiceName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  }, [refresh, voiceName]);

  const deleteVoice = useCallback(
    async (voiceId: string): Promise<void> => {
      setIsBusy(true);
      try {
        const response = await fetch(`/api/voices?id=${encodeURIComponent(voiceId)}`, {
          method: 'DELETE',
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? 'Delete failed');
        }
        toast.success(`Deleted ${voiceId}.`);
        await refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Delete failed');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
  );

  const confirmDeleteVoice = useCallback(
    async (voiceId: string): Promise<void> => {
      const confirmed = await confirm({
        title: 'Delete voice?',
        description: `Delete voice "${voiceId}"? Any character currently assigned to it will lose its voice.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (confirmed) {
        await deleteVoice(voiceId);
      }
    },
    [confirm, deleteVoice],
  );

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">TTS Configuration</div>
            <h1>Model &amp; Voices</h1>
            <p>The voice engine behind every story in this studio.</p>
          </div>
          <div className="button-row">
            <Button asChild variant="secondary">
              <Link href="/">Back</Link>
            </Button>
          </div>
        </div>

        <div className="waveform-divider" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>

        {message ? <p className="status-banner">{message}</p> : null}

        <section className="settings-grid">
          <Card>
            <div className="eyebrow">Engine</div>
            <h2>Model</h2>
            {config ? (
              <>
                <p>
                  <strong>{config.modelRepo}</strong>
                </p>
                <div className="status-line">
                  <Badge variant="good">{config.device}</Badge>
                  <Badge>{config.sampleRate / 1000} kHz</Badge>
                </div>
                <div className="grid gap-1.5">
                  <Label>Model</Label>
                  <Select
                    value={selectedModel}
                    onValueChange={setSelectedModel}
                    disabled={isBusy}
                  >
                    <SelectTrigger disabled={isBusy}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {config.models.map((model) => (
                        <SelectItem key={model.id} value={model.id}>
                          {model.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {!config.models.find((model) => model.id === selectedModel)?.supportsDevice ? (
                  <>
                    <p>
                      This model picks its own backend (Metal on macOS) — there is no device to
                      choose.
                    </p>
                    <div className="grid gap-1.5">
                      <Label>
                        MaskGIT steps: {selectedGgufSteps} (default {config.ggufStepsRange.default})
                      </Label>
                      <Slider
                        min={config.ggufStepsRange.min}
                        max={config.ggufStepsRange.max}
                        step={1}
                        value={[selectedGgufSteps]}
                        onValueChange={(value) =>
                          setSelectedGgufSteps(value[0] ?? config.ggufStepsRange.min)
                        }
                        disabled={isBusy}
                      />
                      <p>
                        Fewer steps generate faster but decode is coarser — generation time
                        scales roughly linearly with this (32→16 steps is about 2x faster).
                        Duration/pacing is unaffected either way. Listen to a preview after
                        lowering it before using it on a real story.
                      </p>
                    </div>
                  </>
                ) : selectedModel === config.model ? (
                  <div className="grid gap-1.5">
                    <Label>Compute device</Label>
                    <Select
                      value={selectedDevice}
                      onValueChange={setSelectedDevice}
                      disabled={isBusy}
                    >
                      <SelectTrigger disabled={isBusy}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {config.devices.map((device) => (
                          <SelectItem key={device.id} value={device.id}>
                            {device.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : (
                  <p>
                    Switching models loads the new model on its default device; you can adjust the
                    device afterwards.
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() => void applyModelSettings()}
                  disabled={isBusy || !hasModelPendingChanges}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Apply
                </Button>
              </>
            ) : (
              <p className="label">{configError || 'Loading...'}</p>
            )}
          </Card>

          <Card className="grid gap-3">
            <div className="eyebrow">Quality Control</div>
            <h2>Audio Verification</h2>
            {config ? (
              <>
                <p>
                  After each segment is generated, Whisper transcribes it and checks it against the
                  script — this is the slowest part of a generation run (a Whisper model load plus a
                  transcription pass per batch). Turn it off to accept generated audio immediately and
                  review it by ear instead.
                </p>
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedVerificationEnabled}
                    onCheckedChange={(checked) => setSelectedVerificationEnabled(checked === true)}
                    disabled={isBusy}
                  />
                  Verify generated audio with Whisper
                </Label>
                <Button
                  type="button"
                  onClick={() => void applyVerificationSetting()}
                  disabled={isBusy || !hasVerificationPendingChanges}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Apply
                </Button>
              </>
            ) : (
              <p className="label">{configError || 'Loading...'}</p>
            )}
          </Card>

          <Card className="grid gap-3">
            <div className="eyebrow">Story Processing</div>
            <h2>Character Segmentation</h2>
            {config ? (
              <>
                <p>
                  When &ldquo;Process story&rdquo; splits your text, it looks for &ldquo;Name:
                  dialogue&rdquo; lines and gives each character its own segment and voice. Turn
                  this off to keep everything as a single narrator — useful if you only ever
                  generate narrator-only audio.
                </p>
                <Label className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedCharacterSegmentationEnabled}
                    onCheckedChange={(checked) => setSelectedCharacterSegmentationEnabled(checked === true)}
                    disabled={isBusy}
                  />
                  Split dialogue into character segments
                </Label>
                <Button
                  type="button"
                  onClick={() => void applySegmentationSetting()}
                  disabled={isBusy || !hasSegmentationPendingChanges}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Apply
                </Button>
              </>
            ) : (
              <p className="label">{configError || 'Loading...'}</p>
            )}
          </Card>

          <Card className="grid gap-3">
            <div className="eyebrow">Publishing</div>
            <h2>YouTube</h2>
            <p>
              Khi final video được duyệt (thủ công hoặc tự động ngay sau khi render xong), app tự
              động upload video lên YouTube ở chế độ <strong>Private</strong> — kèm ảnh intro của
              story làm thumbnail. Bạn tự kiểm tra lại và public thủ công trên YouTube Studio.
            </p>
            {youtubeStatus?.connected ? (
              <>
                <Badge variant="good">
                  Đã kết nối{youtubeStatus.channelTitle ? ` — ${youtubeStatus.channelTitle}` : ''}
                </Badge>
                <div className="button-row">
                  <Button asChild variant="secondary">
                    <a href="/api/youtube/oauth/start">
                      <Youtube size={16} aria-hidden="true" />
                      Kết nối lại / đổi kênh
                    </a>
                  </Button>
                  <Button
                    variant="destructive"
                    type="button"
                    onClick={() => void disconnectYoutubeAccount()}
                    disabled={youtubeBusy}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Ngắt kết nối
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Badge variant="warn">Chưa kết nối</Badge>
                <Button asChild>
                  <a href="/api/youtube/oauth/start">
                    <Youtube size={16} aria-hidden="true" />
                    Kết nối tài khoản YouTube
                  </a>
                </Button>
              </>
            )}
          </Card>

          <Card className="grid gap-3">
            <div className="eyebrow">Voice Library</div>
            <h2>Add Cloned Voice</h2>
            <p>
              Upload a clean 3-5 second WAV of the voice you want to clone. It becomes available
              instantly in the Characters tab.
            </p>
            <div className="grid gap-1.5">
              <Label>Voice name</Label>
              <Input
                value={voiceName}
                onChange={(event) => setVoiceName(event.target.value)}
                placeholder="ong-noi-ke-chuyen"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Reference WAV (3-5s)</Label>
              <Input type="file" accept=".wav,audio/wav" ref={fileInputRef} />
            </div>
            <Button type="button" onClick={() => void uploadVoice()} disabled={isBusy}>
              <Upload size={16} aria-hidden="true" />
              Upload and encode
            </Button>
          </Card>

          <Card className="grid gap-3">
            <div className="eyebrow">Voice Library</div>
            <h2>Replace Reference Audio</h2>
            <p>
              Swap an existing voice&apos;s reference clip for a different WAV file. The voice
              keeps its name — every character already assigned to it just picks up the new
              clip. The old clip is gone permanently once you replace it.
            </p>
            <div className="grid gap-1.5">
              <Label>Voice to replace</Label>
              <Select
                value={replaceVoiceId}
                onValueChange={setReplaceVoiceId}
                disabled={isBusy || voices.length === 0}
              >
                <SelectTrigger disabled={isBusy || voices.length === 0}>
                  <SelectValue placeholder="No voices yet" />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((voice) => (
                    <SelectItem key={voice.id} value={voice.id}>
                      {voice.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>New reference WAV</Label>
              <Input type="file" accept=".wav,audio/wav" ref={replaceFileInputRef} />
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void replaceVoiceAudio()}
              disabled={isBusy || voices.length === 0}
            >
              <Upload size={16} aria-hidden="true" />
              Replace reference audio
            </Button>
          </Card>
        </section>

        <Card>
          <h2>Voices ({voices.length})</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Voice</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {voices.map((voice) => (
                <TableRow key={voice.id}>
                  <TableCell className="mono">
                    {voice.kind === 'clone' ? <Mic size={14} aria-hidden="true" /> : null} {voice.id}
                  </TableCell>
                  <TableCell>
                    <Badge variant={voice.kind === 'clone' ? 'good' : 'default'}>{voice.kind}</Badge>
                  </TableCell>
                  <TableCell>{voice.description}</TableCell>
                  <TableCell>
                    {previewVoiceId === voice.id ? (
                      <audio
                        autoPlay
                        controls
                        src={`/api/voice-preview?voice=${encodeURIComponent(voice.id)}`}
                        onCanPlay={() => setPreviewLoading(false)}
                        onEnded={() => {
                          setPreviewLoading(false);
                          setPreviewVoiceId('');
                        }}
                        onError={() => {
                          setPreviewLoading(false);
                          setPreviewVoiceId('');
                          toast.error('Could not play preview.');
                        }}
                      />
                    ) : (
                      <Button
                        variant="secondary"
                        type="button"
                        title="Synthesize a short horror sample with this voice"
                        disabled={previewLoading}
                        onClick={() => {
                          setPreviewLoading(true);
                          setPreviewVoiceId(voice.id);
                        }}
                      >
                        <Play size={15} aria-hidden="true" />
                        {previewLoading ? 'Loading...' : 'Test'}
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    {voice.kind === 'clone' ? (
                      <Button
                        variant="destructive"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void confirmDeleteVoice(voice.id)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </main>
    </AppShell>
  );
};

export default SettingsClient;
