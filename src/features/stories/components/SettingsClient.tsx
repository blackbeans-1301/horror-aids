'use client';

import Link from 'next/link';
import { Mic, Play, RefreshCw, Trash2, Upload } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import { storiesApi, type VoiceOption } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';

interface TtsConfig {
  model: string;
  modelLabel: string;
  modelRepo: string;
  models: Array<{ id: string; label: string }>;
  device: string;
  devices: Array<{ id: string; label: string }>;
  sampleRate: number;
  emotions: string[];
  inlineCues: string[];
  voicesDir: string;
  verificationEnabled: boolean;
  notes: string;
  error?: string;
}

export const SettingsClient: React.FC = () => {
  const [config, setConfig] = useState<TtsConfig | null>(null);
  const [configError, setConfigError] = useState<string>('');
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [message, setMessage] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [voiceName, setVoiceName] = useState<string>('');
  const [previewVoiceId, setPreviewVoiceId] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('k2-fsa/OmniVoice');
  const [selectedDevice, setSelectedDevice] = useState<string>('auto');
  const [selectedVerificationEnabled, setSelectedVerificationEnabled] = useState<boolean>(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const hasPendingChanges =
    config !== null &&
    (selectedModel !== config.model ||
      selectedDevice !== config.device ||
      selectedVerificationEnabled !== config.verificationEnabled);

  const applyEngine = useCallback(async (): Promise<void> => {
    if (!config) {
      return;
    }
    const switchingModel = selectedModel !== config.model;
    const body: { model?: string; device?: string; verificationEnabled?: boolean } = switchingModel
      ? { model: selectedModel }
      : { device: selectedDevice };
    if (selectedVerificationEnabled !== config.verificationEnabled) {
      body.verificationEnabled = selectedVerificationEnabled;
    }

    setIsBusy(true);
    setMessage('Saving...');
    try {
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
      setMessage(
        `Saved — ${data.modelLabel} on ${data.device.toUpperCase()} will be used for the next ` +
          'preview or generation run (first real run downloads the model, which can take a while). ' +
          `Audio verification is ${data.verificationEnabled ? 'ON' : 'OFF'}.`,
      );
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [config, refresh, selectedDevice, selectedModel, selectedVerificationEnabled]);

  const uploadVoice = useCallback(async (): Promise<void> => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setMessage('Choose a WAV file first.');
      return;
    }
    if (!voiceName.trim()) {
      setMessage('Give the voice a name first.');
      return;
    }

    setIsBusy(true);
    setMessage('Uploading and encoding reference clip...');
    try {
      const buffer = await file.arrayBuffer();
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const response = await fetch('/api/voices', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: voiceName, wavBase64: btoa(binary) }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? 'Upload failed');
      }
      setMessage(`Voice ${data.id} is ready to use in the Characters tab.`);
      setVoiceName('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  }, [refresh, voiceName]);

  const deleteVoice = useCallback(
    async (voiceId: string): Promise<void> => {
      setIsBusy(true);
      setMessage(`Deleting ${voiceId}...`);
      try {
        const response = await fetch(`/api/voices?id=${encodeURIComponent(voiceId)}`, {
          method: 'DELETE',
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(data.error ?? 'Delete failed');
        }
        setMessage(`Deleted ${voiceId}.`);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Delete failed');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
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
            <Link className="button secondary" href="/">
              Back
            </Link>
            <button className="button secondary" type="button" onClick={() => void refresh()}>
              <RefreshCw size={16} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        {message ? <p className="panel">{message}</p> : null}

        <section className="grid">
          <div className="panel">
            <h2>Model</h2>
            {config ? (
              <>
                <p>
                  <strong>{config.modelRepo}</strong>
                </p>
                <div className="status-line">
                  <span className="badge good">{config.device}</span>
                  <span className="badge">{config.sampleRate / 1000} kHz</span>
                </div>
                <p className="label">{config.notes}</p>
                {config.emotions.length > 0 ? (
                  <p className="label">
                    Emotions: {config.emotions.join(', ')} · Inline cues: {config.inlineCues.join(' ')}
                  </p>
                ) : (
                  <p className="label">This model has no emotion controls.</p>
                )}
                <label className="field">
                  <span className="label">Model</span>
                  <select
                    className="select"
                    value={selectedModel}
                    onChange={(event) => setSelectedModel(event.target.value)}
                    disabled={isBusy}
                  >
                    {config.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedModel === config.model ? (
                  <label className="field">
                    <span className="label">Compute device</span>
                    <select
                      className="select"
                      value={selectedDevice}
                      onChange={(event) => setSelectedDevice(event.target.value)}
                      disabled={isBusy}
                    >
                      {config.devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="label">
                    Switching models loads the new model on its default device; you can adjust the
                    device afterwards.
                  </p>
                )}
                <button
                  className="button"
                  type="button"
                  onClick={() => void applyEngine()}
                  disabled={isBusy || !hasPendingChanges}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Apply
                </button>
              </>
            ) : (
              <p className="label">{configError || 'Loading...'}</p>
            )}
          </div>

          <div className="panel form">
            <h2>Audio Verification</h2>
            {config ? (
              <>
                <p className="label">
                  After each segment is generated, Whisper transcribes it and checks it against the
                  script — this is the slowest part of a generation run (a Whisper model load plus a
                  transcription pass per batch). Turn it off to accept generated audio immediately and
                  review it by ear instead.
                </p>
                <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="checkbox"
                    checked={selectedVerificationEnabled}
                    onChange={(event) => setSelectedVerificationEnabled(event.target.checked)}
                    disabled={isBusy}
                  />
                  <span className="label">Verify generated audio with Whisper</span>
                </label>
                <button
                  className="button"
                  type="button"
                  onClick={() => void applyEngine()}
                  disabled={isBusy || !hasPendingChanges}
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Apply
                </button>
              </>
            ) : (
              <p className="label">{configError || 'Loading...'}</p>
            )}
          </div>

          <div className="panel form">
            <h2>Add Cloned Voice</h2>
            <p className="label">
              Upload a clean 3-5 second WAV of the voice you want to clone. It becomes available
              instantly in the Characters tab.
            </p>
            <label className="field">
              <span className="label">Voice name</span>
              <input
                className="input"
                value={voiceName}
                onChange={(event) => setVoiceName(event.target.value)}
                placeholder="ong-noi-ke-chuyen"
              />
            </label>
            <label className="field">
              <span className="label">Reference WAV (3-5s)</span>
              <input className="input" type="file" accept=".wav,audio/wav" ref={fileInputRef} />
            </label>
            <button className="button" type="button" onClick={() => void uploadVoice()} disabled={isBusy}>
              <Upload size={16} aria-hidden="true" />
              Upload and encode
            </button>
          </div>
        </section>

        <section className="panel">
          <h2>Voices ({voices.length})</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Voice</th>
                <th>Type</th>
                <th>Description</th>
                <th>Preview</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {voices.map((voice) => (
                <tr key={voice.id}>
                  <td className="mono">
                    {voice.kind === 'clone' ? <Mic size={14} aria-hidden="true" /> : null} {voice.id}
                  </td>
                  <td>
                    <span className={voice.kind === 'clone' ? 'badge good' : 'badge'}>{voice.kind}</span>
                  </td>
                  <td>{voice.description}</td>
                  <td>
                    {previewVoiceId === voice.id ? (
                      <audio
                        autoPlay
                        controls
                        src={`/api/voice-preview?voice=${encodeURIComponent(voice.id)}`}
                      />
                    ) : (
                      <button
                        className="button secondary"
                        type="button"
                        title="Synthesize a short horror sample with this voice"
                        onClick={() => setPreviewVoiceId(voice.id)}
                      >
                        <Play size={15} aria-hidden="true" />
                        Test
                      </button>
                    )}
                  </td>
                  <td>
                    {voice.kind === 'clone' ? (
                      <button
                        className="button danger"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void deleteVoice(voice.id)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </AppShell>
  );
};

export default SettingsClient;
