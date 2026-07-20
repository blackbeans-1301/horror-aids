import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { storiesApi, type VoiceOption } from '@/features/stories/api/storiesApi';
import type {
  CharacterRecord,
  JobRecord,
  JobType,
  SegmentRecord,
  StoryDetail,
} from '@/types/story';

export type TabId = 'overview' | 'story' | 'characters' | 'segments' | 'audio' | 'logs';

function nextLocalSegmentId(segments: SegmentRecord[]): number {
  return (
    segments.reduce((max, segment) => {
      const parsed = Number.parseInt(segment.id, 10);
      return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
    }, 0) + 1
  );
}

function createEmptySegment(order: number, speakerId = 'narrator'): SegmentRecord {
  const id = `${order}`.padStart(4, '0');
  return {
    id,
    order,
    speakerId,
    text: '',
    emotion: speakerId === 'narrator' ? 'storytelling' : 'natural',
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

export function useStoryWorkspace(slug: string) {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [loadError, setLoadError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [storyText, setStoryText] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobLog, setJobLog] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  // Unsaved local edits must survive the 3s polling refresh; each flag blocks
  // the server snapshot from overwriting that piece of state until saved.
  const dirtyRef = useRef({ story: false, characters: false, segments: false });
  // Mirrors dirtyRef for the UI (refs don't trigger re-renders).
  const [dirty, setDirty] = useState({ story: false, characters: false, segments: false });
  type DirtyKey = 'story' | 'characters' | 'segments';
  const markDirty = useCallback((key: DirtyKey): void => {
    dirtyRef.current[key] = true;
    setDirty((current) => ({ ...current, [key]: true }));
  }, []);
  const clearDirty = useCallback((key: DirtyKey): void => {
    dirtyRef.current[key] = false;
    setDirty((current) => ({ ...current, [key]: false }));
  }, []);
  const hadDetailRef = useRef(false);
  const pollErrorWarnedRef = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const nextDetail = await storiesApi.detail(slug);
      setDetail(nextDetail);
      if (!dirtyRef.current.story) {
        setStoryText(nextDetail.storyText);
      }
      if (!dirtyRef.current.characters) {
        setCharacters(nextDetail.characters.characters);
      }
      if (!dirtyRef.current.segments) {
        setSegments(nextDetail.segments.segments);
      }
      setSelectedJobId((current) => current || nextDetail.recentJobs[0]?.id || '');
      setLoadError('');
      hadDetailRef.current = true;
      pollErrorWarnedRef.current = false;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Could not load story';
      if (!hadDetailRef.current) {
        setLoadError(messageText);
      } else if (!pollErrorWarnedRef.current) {
        toast.error(messageText);
        pollErrorWarnedRef.current = true;
      }
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
    return new Set(
      segments.filter((segment) => segment.status !== 'skipped').map((segment) => segment.speakerId),
    );
  }, [segments]);

  const voicesReady = useMemo(() => {
    if (segments.length === 0) {
      return false;
    }
    return [...usedSpeakerIds].every((speakerId) =>
      characters.some((character) => character.id === speakerId && character.voice.trim()),
    );
  }, [characters, segments.length, usedSpeakerIds]);

  // Sequential preview player: plays verified segments in story order and
  // auto-advances, so the full story can be heard before concat.
  const [playerIndex, setPlayerIndex] = useState<number | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesError, setVoicesError] = useState<string>('');
  const [regenSelection, setRegenSelection] = useState<Set<string>>(new Set());

  useEffect(() => {
    void storiesApi
      .voices()
      .then((data) => {
        setVoices(data.voices);
        setVoicesError(data.voices.length === 0 ? data.error ?? '' : '');
      })
      .catch(() => setVoicesError('Could not load voices from the TTS server.'));
  }, []);

  const toggleRegenSelection = useCallback((segmentId: string): void => {
    setRegenSelection((current) => {
      const next = new Set(current);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  }, []);

  const playableSegments = useMemo(() => {
    return segments.filter(
      (segment) =>
        segment.status !== 'skipped' &&
        (segment.verification.status === 'passed' || segment.status === 'complete'),
    );
  }, [segments]);

  const playingSegment = playerIndex !== null ? playableSegments[playerIndex] ?? null : null;

  const playFromSegment = useCallback(
    (segmentId: string): void => {
      const index = playableSegments.findIndex((segment) => segment.id === segmentId);
      if (index >= 0) {
        setPlayerIndex(index);
      }
    },
    [playableSegments],
  );

  const handleSegmentEnded = useCallback((): void => {
    setPlayerIndex((current) => {
      if (current === null) {
        return null;
      }
      return current < playableSegments.length - 1 ? current + 1 : null;
    });
  }, [playableSegments.length]);

  const allVerified = useMemo(() => {
    return (
      segments.length > 0 &&
      segments.every((segment) => segment.status === 'skipped' || segment.verification.status === 'passed')
    );
  }, [segments]);

  const segmentApproval = detail?.story.approvals.segments.status ?? 'pending';
  const verifiedApproval = detail?.story.approvals.verifiedAudio.status ?? 'pending';
  const hasActiveJob = detail?.activeJob !== null && detail?.activeJob !== undefined;
  const canProcess = storyText.trim().length > 0 && !hasActiveJob;
  const canGenerate = segmentApproval === 'approved' && voicesReady && !hasActiveJob;
  const canConfirmVerified = allVerified && !hasActiveJob;
  const canConcat = verifiedApproval === 'approved' && !hasActiveJob;

  const runAction = useCallback(
    async (action: () => Promise<void>, successMessage = ''): Promise<void> => {
      setIsBusy(true);
      try {
        await action();
        await refresh();
        if (successMessage) {
          toast.success(successMessage);
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Action failed');
      } finally {
        setIsBusy(false);
      }
    },
    [refresh],
  );

  const startJob = useCallback(
    async (type: JobType, segmentIds?: string[]): Promise<void> => {
      await runAction(async () => {
        const job = await storiesApi.startJob(slug, type, segmentIds);
        setSelectedJobId(job.id);
        if (!segmentIds) {
          setActiveTab('logs');
        }
      });
    },
    [runAction, slug],
  );

  const saveStory = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      await storiesApi.saveStoryText(slug, storyText);
      clearDirty('story');
    }, 'Story saved.');
  }, [clearDirty, runAction, slug, storyText]);

  const saveCharacters = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      await storiesApi.saveCharacters(slug, { characters });
      clearDirty('characters');
    }, 'Characters saved.');
  }, [characters, clearDirty, runAction, slug]);

  const saveSegments = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      await storiesApi.saveSegments(slug, { segments });
      clearDirty('segments');
    }, 'Segments saved.');
  }, [clearDirty, runAction, segments, slug]);

  const approveSegments = useCallback(async (): Promise<void> => {
    await runAction(
      () => storiesApi.approveSegments(slug),
      'Segments approved. You can now run Generate + verify in the Audio tab.',
    );
  }, [runAction, slug]);

  const confirmVerifiedAudio = useCallback(async (): Promise<void> => {
    await runAction(
      () => storiesApi.confirmVerifiedAudio(slug),
      'Verified output confirmed. Concat final WAV is now unlocked.',
    );
  }, [runAction, slug]);

  const approveFinalAudio = useCallback(async (): Promise<void> => {
    await runAction(
      () => storiesApi.approveFinalAudio(slug),
      'Final audio approved. This story is complete.',
    );
  }, [runAction, slug]);

  const loadJobLog = useCallback(async (jobId: string): Promise<void> => {
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
  }, []);

  useEffect(() => {
    if (selectedJobId) {
      void loadJobLog(selectedJobId);
    }
  }, [loadJobLog, selectedJobId, detail?.activeJob?.status]);

  // Tail the running job's log so progress is visible without re-selecting it.
  useEffect(() => {
    if (!detail?.activeJob || detail.activeJob.id !== selectedJobId) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadJobLog(selectedJobId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [detail?.activeJob, loadJobLog, selectedJobId]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent): void => {
      if (dirty.story || dirty.characters || dirty.segments) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const updateCharacter = useCallback((index: number, patch: Partial<CharacterRecord>): void => {
    markDirty('characters');
    setCharacters((current) =>
      current.map((character, characterIndex) =>
        characterIndex === index ? { ...character, ...patch } : character,
      ),
    );
  }, [markDirty]);

  const addCharacter = useCallback((): void => {
    markDirty('characters');
    setCharacters((current) => [
      ...current,
      { id: `character-${current.length + 1}`, name: `Character ${current.length + 1}`, role: 'other', voice: '' },
    ]);
  }, [markDirty]);

  const removeCharacter = useCallback((index: number): void => {
    markDirty('characters');
    setCharacters((current) => current.filter((_, characterIndex) => characterIndex !== index));
  }, [markDirty]);

  const updateSegment = useCallback((index: number, patch: Partial<SegmentRecord>): void => {
    markDirty('segments');
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
  }, [markDirty]);

  const addSegment = useCallback((): void => {
    markDirty('segments');
    setSegments((current) => {
      const inserted = createEmptySegment(nextLocalSegmentId(current));
      return [...current, { ...inserted, order: current.length + 1 }];
    });
  }, [markDirty]);

  const insertSegmentAfter = useCallback((index: number): void => {
    markDirty('segments');
    setSegments((current) => {
      const anchor = current[index];
      const inserted = createEmptySegment(nextLocalSegmentId(current), anchor?.speakerId ?? 'narrator');
      const next = [...current];
      next.splice(index + 1, 0, inserted);
      return next.map((segment, orderIndex) => ({ ...segment, order: orderIndex + 1 }));
    });
  }, [markDirty]);

  const deleteSegment = useCallback((index: number): void => {
    markDirty('segments');
    setSegments((current) => current.filter((_, segmentIndex) => segmentIndex !== index));
  }, [markDirty]);

  const splitSegment = useCallback((index: number): void => {
    markDirty('segments');
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
      const inserted = createEmptySegment(nextLocalSegmentId(current), target.speakerId);
      inserted.text = second;
      inserted.emotion = target.emotion;
      const next = [...current];
      next[index] = { ...target, text: first };
      next.splice(index + 1, 0, inserted);
      return next.map((segment, orderIndex) => ({ ...segment, order: orderIndex + 1 }));
    });
  }, [markDirty]);

  const mergeWithNext = useCallback((index: number): void => {
    markDirty('segments');
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
  }, [markDirty]);

  return {
    slug,
    detail,
    loadError,
    activeTab,
    setActiveTab,
    storyText,
    setStoryText: (value: string): void => {
      markDirty('story');
      setStoryText(value);
    },
    characters,
    segments,
    selectedJobId,
    selectedJob,
    jobLog,
    isBusy,
    dirty,
    voices,
    voicesError,
    regenSelection,
    toggleRegenSelection,
    setRegenSelection,
    playerIndex,
    setPlayerIndex,
    playableSegments,
    playingSegment,
    playFromSegment,
    handleSegmentEnded,
    voicesReady,
    allVerified,
    segmentApproval,
    verifiedApproval,
    hasActiveJob,
    canProcess,
    canGenerate,
    canConfirmVerified,
    canConcat,
    refresh,
    startJob,
    saveStory,
    saveCharacters,
    saveSegments,
    approveSegments,
    confirmVerifiedAudio,
    approveFinalAudio,
    loadJobLog,
    updateCharacter,
    addCharacter,
    removeCharacter,
    updateSegment,
    addSegment,
    insertSegmentAfter,
    deleteSegment,
    splitSegment,
    mergeWithNext,
  };
}

export type StoryWorkspace = ReturnType<typeof useStoryWorkspace>;
