'use client';

import Link from 'next/link';
import {
  AudioLines,
  Check,
  FileText,
  ListChecks,
  Play,
  RefreshCw,
  Save,
  Scissors,
  Terminal,
  Trash2,
  Users,
  Wand2,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { storiesApi } from '@/features/stories/api/storiesApi';
import { AppShell } from '@/features/stories/components/AppShell';
import type {
  CharacterRecord,
  CharacterRole,
  JobRecord,
  JobType,
  SegmentRecord,
  StoryDetail,
} from '@/types/story';

interface StoryWorkspaceClientProps {
  slug: string;
}

type TabId = 'overview' | 'story' | 'characters' | 'segments' | 'audio' | 'logs';

const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <ListChecks size={15} aria-hidden="true" /> },
  { id: 'story', label: 'Story', icon: <FileText size={15} aria-hidden="true" /> },
  { id: 'characters', label: 'Characters', icon: <Users size={15} aria-hidden="true" /> },
  { id: 'segments', label: 'Segments', icon: <Scissors size={15} aria-hidden="true" /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={15} aria-hidden="true" /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={15} aria-hidden="true" /> },
];

const roleOptions: CharacterRole[] = [
  'narrator',
  'main_character',
  'side_character',
  'villain',
  'other',
];

function assetUrl(slug: string, relativePath: string): string {
  return `/api/stories/${slug}/asset?path=${encodeURIComponent(relativePath)}`;
}

function segmentAudioPath(segment: SegmentRecord): string {
  return segment.audioPath;
}

function createEmptySegment(order: number, speakerId = 'narrator'): SegmentRecord {
  const id = `${order}`.padStart(4, '0');
  return {
    id,
    order,
    speakerId,
    text: '',
    audioPath: `audio/segments/${id}-${speakerId}.wav`,
    whisperTranscriptPath: `tmp/whisper/${id}-${speakerId}.txt`,
    status: 'pending',
    verification: {
      status: 'pending',
      attempts: 0,
      lastError: null,
      transcriptPreview: null,
    },
  };
}

export const StoryWorkspaceClient: React.FC<StoryWorkspaceClientProps> = ({ slug }) => {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [storyText, setStoryText] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [message, setMessage] = useState<string>('Loading workspace...');
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobLog, setJobLog] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const nextDetail = await storiesApi.detail(slug);
      setDetail(nextDetail);
      setStoryText(nextDetail.storyText);
      setCharacters(nextDetail.characters.characters);
      setSegments(nextDetail.segments.segments);
      setSelectedJobId((current) => current || nextDetail.recentJobs[0]?.id || '');
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load story');
    }
  }, [slug]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedJob = useMemo<JobRecord | null>(() => {
    return detail?.recentJobs.find((job) => job.id === selectedJobId) ?? null;
  }, [detail?.recentJobs, selectedJobId]);

  const usedSpeakerIds = useMemo(() => {
    return new Set(segments.filter((segment) => segment.status !== 'skipped').map((segment) => segment.speakerId));
  }, [segments]);

  const voicesReady = useMemo(() => {
    if (segments.length === 0) {
      return false;
    }
    return [...usedSpeakerIds].every((speakerId) =>
      characters.some((character) => character.id === speakerId && character.voice.trim()),
    );
  }, [characters, segments.length, usedSpeakerIds]);

  const allVerified = useMemo(() => {
    return (
      segments.length > 0 &&
      segments.every(
        (segment) =>
          segment.status === 'skipped' || segment.verification.status === 'passed',
      )
    );
  }, [segments]);

  const segmentApproval = detail?.story.approvals.segments.status ?? 'pending';
  const verifiedApproval = detail?.story.approvals.verifiedAudio.status ?? 'pending';
  const hasActiveJob = detail?.activeJob !== null && detail?.activeJob !== undefined;
  const canProcess = storyText.trim().length > 0 && !hasActiveJob;
  const canGenerate =
    segmentApproval === 'approved' && voicesReady && !hasActiveJob;
  const canConfirmVerified = allVerified && !hasActiveJob;
  const canConcat = verifiedApproval === 'approved' && !hasActiveJob;

  const runAction = useCallback(
    async (label: string, action: () => Promise<void>): Promise<void> => {
      setIsBusy(true);
      setMessage(label);
      try {
        await action();
        await refresh();
        setMessage('');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Action failed');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
  );

  const startJob = useCallback(
    async (type: JobType): Promise<void> => {
      await runAction('Starting job...', async () => {
        const job = await storiesApi.startJob(slug, type);
        setSelectedJobId(job.id);
        setActiveTab('logs');
      });
    },
    [runAction, slug],
  );

  const saveStory = useCallback(async (): Promise<void> => {
    await runAction('Saving story...', () => storiesApi.saveStoryText(slug, storyText));
  }, [runAction, slug, storyText]);

  const saveCharacters = useCallback(async (): Promise<void> => {
    await runAction('Saving characters...', async () => {
      await storiesApi.saveCharacters(slug, { characters });
    });
  }, [characters, runAction, slug]);

  const saveSegments = useCallback(async (): Promise<void> => {
    await runAction('Saving segments...', async () => {
      await storiesApi.saveSegments(slug, { segments });
    });
  }, [runAction, segments, slug]);

  const approveSegments = useCallback(async (): Promise<void> => {
    await runAction('Approving segments...', () => storiesApi.approveSegments(slug));
  }, [runAction, slug]);

  const confirmVerifiedAudio = useCallback(async (): Promise<void> => {
    await runAction('Confirming verified output...', () =>
      storiesApi.confirmVerifiedAudio(slug),
    );
  }, [runAction, slug]);

  const approveFinalAudio = useCallback(async (): Promise<void> => {
    await runAction('Approving final audio...', () => storiesApi.approveFinalAudio(slug));
  }, [runAction, slug]);

  const loadJobLog = useCallback(
    async (jobId: string): Promise<void> => {
      setSelectedJobId(jobId);
      if (!jobId) {
        setJobLog('');
        return;
      }
      try {
        const log = await storiesApi.jobLog(jobId);
        setJobLog(log || 'Log is empty.');
      } catch (error) {
        setJobLog(error instanceof Error ? error.message : 'Could not load log');
      }
    },
    [],
  );

  useEffect(() => {
    if (selectedJobId) {
      void loadJobLog(selectedJobId);
    }
  }, [loadJobLog, selectedJobId, detail?.activeJob?.status]);

  const updateCharacter = useCallback(
    (index: number, patch: Partial<CharacterRecord>): void => {
      setCharacters((current) =>
        current.map((character, characterIndex) =>
          characterIndex === index ? { ...character, ...patch } : character,
        ),
      );
    },
    [],
  );

  const addCharacter = useCallback((): void => {
    const id = `character-${characters.length + 1}`;
    setCharacters((current) => [
      ...current,
      { id, name: `Character ${current.length + 1}`, role: 'other', voice: '' },
    ]);
  }, [characters.length]);

  const removeCharacter = useCallback((index: number): void => {
    setCharacters((current) => current.filter((_, characterIndex) => characterIndex !== index));
  }, []);

  const updateSegment = useCallback(
    (index: number, patch: Partial<SegmentRecord>): void => {
      setSegments((current) =>
        current.map((segment, segmentIndex) => {
          if (segmentIndex !== index) {
            return segment;
          }

          const next = { ...segment, ...patch };
          if (patch.speakerId) {
            next.audioPath = `audio/segments/${next.id}-${patch.speakerId}.wav`;
            next.whisperTranscriptPath = `tmp/whisper/${next.id}-${patch.speakerId}.txt`;
          }
          return next;
        }),
      );
    },
    [],
  );

  const addSegment = useCallback((): void => {
    setSegments((current) => [...current, createEmptySegment(current.length + 1)]);
  }, []);

  const deleteSegment = useCallback((index: number): void => {
    setSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }, []);

  const splitSegment = useCallback((index: number): void => {
    setSegments((current) => {
      const target = current[index];
      if (!target) {
        return current;
      }
      const words = target.text.split(/\s+/).filter(Boolean);
      if (words.length < 4) {
        return current;
      }
      const midpoint = Math.ceil(words.length / 2);
      const first = words.slice(0, midpoint).join(' ');
      const second = words.slice(midpoint).join(' ');
      const inserted = createEmptySegment(current.length + 1, target.speakerId);
      inserted.text = second;
      const next = [...current];
      next[index] = { ...target, text: first };
      next.splice(index + 1, 0, inserted);
      return next.map((segment, orderIndex) => ({ ...segment, order: orderIndex + 1 }));
    });
  }, []);

  const mergeWithNext = useCallback((index: number): void => {
    setSegments((current) => {
      const target = current[index];
      const nextSegment = current[index + 1];
      if (!target || !nextSegment) {
        return current;
      }
      const merged = {
        ...target,
        text: `${target.text.trim()} ${nextSegment.text.trim()}`.trim(),
      };
      return current
        .map((segment, segmentIndex) => (segmentIndex === index ? merged : segment))
        .filter((_, segmentIndex) => segmentIndex !== index + 1)
        .map((segment, orderIndex) => ({ ...segment, order: orderIndex + 1 }));
    });
  }, []);

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">Story Workspace</div>
            <h1>{detail?.story.title ?? slug}</h1>
            <p className="status-line">
              <span className="badge">{detail?.story.status ?? 'loading'}</span>
              <span className="badge">segments {segmentApproval}</span>
              <span className={allVerified ? 'badge good' : 'badge warn'}>
                verified {allVerified ? 'passed' : 'pending'}
              </span>
              <span className="badge">final {detail?.story.approvals.finalAudio.status ?? 'pending'}</span>
            </p>
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

        <div className="tabs">
          {tabs.map((tab) => (
            <button
              className={activeTab === tab.id ? 'tab active' : 'tab'}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              type="button"
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <section className="grid">
            <div className="panel">
              <h2>Pipeline</h2>
              <p>Segment approval unlocks TTS. Whisper verification unlocks user validation. User validation unlocks concat.</p>
              <div className="status-line">
                <span className={storyText.trim() ? 'badge good' : 'badge warn'}>story</span>
                <span className={segments.length ? 'badge good' : 'badge warn'}>segments</span>
                <span className={segmentApproval === 'approved' ? 'badge good' : 'badge warn'}>approved</span>
                <span className={allVerified ? 'badge good' : 'badge warn'}>verified</span>
                <span className={verifiedApproval === 'approved' ? 'badge good' : 'badge warn'}>confirmed</span>
                <span className={detail?.finalAudioExists ? 'badge good' : 'badge warn'}>final wav</span>
              </div>
            </div>
            <div className="panel">
              <h2>Quick Actions</h2>
              <div className="button-row">
                <button className="button secondary" type="button" onClick={saveStory} disabled={isBusy}>
                  <Save size={16} aria-hidden="true" />
                  Save story
                </button>
                <button className="button secondary" type="button" disabled={!canProcess} onClick={() => void startJob('process_story')}>
                  <Wand2 size={16} aria-hidden="true" />
                  Process story
                </button>
                <button className="button secondary" type="button" disabled={!canGenerate} onClick={() => void startJob('generate_verify_tts')}>
                  <AudioLines size={16} aria-hidden="true" />
                  Generate + verify
                </button>
                <button className="button secondary" type="button" disabled={!canConfirmVerified} onClick={confirmVerifiedAudio}>
                  <Check size={16} aria-hidden="true" />
                  Confirm verified output
                </button>
                <button className="button secondary" type="button" disabled={!canConcat} onClick={() => void startJob('concat_audio')}>
                  <Play size={16} aria-hidden="true" />
                  Concat final WAV
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === 'story' ? (
          <section className="panel form">
            <h2>Story Editor</h2>
            <textarea className="textarea large" value={storyText} onChange={(event) => setStoryText(event.target.value)} />
            <div className="button-row">
              <button className="button" type="button" onClick={saveStory} disabled={isBusy}>
                <Save size={16} aria-hidden="true" />
                Save draft
              </button>
              <button className="button secondary" type="button" onClick={() => void startJob('process_story')} disabled={!canProcess}>
                <Wand2 size={16} aria-hidden="true" />
                Process story
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === 'characters' ? (
          <section className="panel form">
            <div className="page-header">
              <div>
                <h2>Characters And Voices</h2>
                <p>Every speaker used by segments needs a VieNue voice ID.</p>
              </div>
              <button className="button secondary" type="button" onClick={addCharacter}>
                Add character
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>VieNue voice</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {characters.map((character, index) => (
                  <tr key={`${character.id}-${index}`}>
                    <td>
                      <input className="input mono" value={character.id} onChange={(event) => updateCharacter(index, { id: event.target.value })} />
                    </td>
                    <td>
                      <input className="input" value={character.name} onChange={(event) => updateCharacter(index, { name: event.target.value })} />
                    </td>
                    <td>
                      <select className="select" value={character.role} onChange={(event) => updateCharacter(index, { role: event.target.value as CharacterRole })}>
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input mono" value={character.voice} onChange={(event) => updateCharacter(index, { voice: event.target.value })} placeholder="vienue_voice_id" />
                    </td>
                    <td>
                      <button className="button danger" type="button" onClick={() => removeCharacter(index)} disabled={character.role === 'narrator'}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button className="button" type="button" onClick={saveCharacters} disabled={isBusy}>
              <Save size={16} aria-hidden="true" />
              Save characters
            </button>
          </section>
        ) : null}

        {activeTab === 'segments' ? (
          <section className="panel form">
            <div className="page-header">
              <div>
                <h2>Segments</h2>
                <p>Approve these rows before TTS. Editing them later resets verification.</p>
              </div>
              <button className="button secondary" type="button" onClick={addSegment}>
                Add segment
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Speaker</th>
                  <th>Text</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {segments.map((segment, index) => (
                  <tr key={`${segment.id}-${index}`}>
                    <td className="mono">{segment.order}</td>
                    <td>
                      <select className="select" value={segment.speakerId} onChange={(event) => updateSegment(index, { speakerId: event.target.value })}>
                        {characters.map((character) => (
                          <option key={character.id} value={character.id}>{character.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea className="textarea" value={segment.text} onChange={(event) => updateSegment(index, { text: event.target.value })} />
                    </td>
                    <td>
                      <span className="badge">{segment.status}</span>
                    </td>
                    <td>
                      <div className="button-row">
                        <button className="button secondary" type="button" onClick={() => splitSegment(index)}>Split</button>
                        <button className="button secondary" type="button" onClick={() => mergeWithNext(index)}>Merge</button>
                        <button className="button danger" type="button" onClick={() => deleteSegment(index)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="button-row">
              <button className="button secondary" type="button" onClick={saveSegments} disabled={isBusy}>
                <Save size={16} aria-hidden="true" />
                Save segments
              </button>
              <button className="button" type="button" onClick={approveSegments} disabled={isBusy || segments.length === 0 || !voicesReady}>
                <Check size={16} aria-hidden="true" />
                Accept segments for TTS
              </button>
            </div>
          </section>
        ) : null}

        {activeTab === 'audio' ? (
          <section className="panel form">
            <div className="page-header">
              <div>
                <h2>Audio Verification</h2>
                <p>Generate TTS, inspect Whisper transcripts, confirm verified output, then concat.</p>
              </div>
            </div>
            <div className="button-row">
              <button className="button secondary" type="button" onClick={() => void startJob('generate_verify_tts')} disabled={!canGenerate}>
                <AudioLines size={16} aria-hidden="true" />
                Generate + verify TTS
              </button>
              <button className="button secondary" type="button" onClick={confirmVerifiedAudio} disabled={!canConfirmVerified}>
                <Check size={16} aria-hidden="true" />
                Confirm verified output
              </button>
              <button className="button secondary" type="button" onClick={() => void startJob('concat_audio')} disabled={!canConcat}>
                <Play size={16} aria-hidden="true" />
                Concat final WAV
              </button>
              <button className="button" type="button" onClick={approveFinalAudio} disabled={!detail?.finalAudioExists}>
                <Check size={16} aria-hidden="true" />
                Approve final audio
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Speaker</th>
                  <th>Verification</th>
                  <th>Transcript</th>
                  <th>Audio</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((segment) => (
                  <tr key={segment.id}>
                    <td className="mono">{segment.id}</td>
                    <td>{segment.speakerId}</td>
                    <td>
                      <span className={segment.verification.status === 'passed' ? 'badge good' : segment.verification.status === 'failed' || segment.verification.status === 'max_attempts_reached' ? 'badge bad' : 'badge warn'}>
                        {segment.verification.status}
                      </span>
                      <div className="label">attempts {segment.verification.attempts}</div>
                    </td>
                    <td>{segment.verification.transcriptPreview || segment.verification.lastError || 'No transcript yet'}</td>
                    <td>
                      {segment.status === 'complete' || segment.verification.status === 'passed' ? (
                        <audio controls src={assetUrl(slug, segmentAudioPath(segment))} />
                      ) : (
                        <span className="label">No audio</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="panel">
              <h3>Final WAV</h3>
              {detail?.finalAudioExists ? (
                <audio controls src={assetUrl(slug, detail.story.audio.finalPath)} />
              ) : (
                <p>Final audio will appear after concat.</p>
              )}
            </div>
          </section>
        ) : null}

        {activeTab === 'logs' ? (
          <section className="split">
            <div className="panel">
              <h2>Jobs</h2>
              <div className="story-list">
                {detail?.recentJobs.map((job) => (
                  <button className="story-item" key={job.id} type="button" onClick={() => void loadJobLog(job.id)}>
                    <span className="status-line">
                      <strong>{job.type}</strong>
                      <span className="badge">{job.status}</span>
                    </span>
                    <span className="mono">{job.id}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="panel">
              <h2>Log</h2>
              <p>{selectedJob?.command.join(' ') ?? 'Select a job.'}</p>
              <pre className="log">{jobLog || 'No log selected.'}</pre>
            </div>
          </section>
        ) : null}
      </main>
    </AppShell>
  );
};

export default StoryWorkspaceClient;
