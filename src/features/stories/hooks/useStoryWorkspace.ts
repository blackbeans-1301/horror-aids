import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { storiesApi, type VoiceOption } from '@/features/stories/api/storiesApi';
import type {
  CharacterRecord,
  JobRecord,
  JobType,
  SegmentRecord,
  StoryDetail,
  VideoPlanFile,
  YoutubeMetadataFieldGroup,
  YoutubeMetadataFile,
} from '@/types/story';

export type TabId =
  | 'overview'
  | 'story'
  | 'characters'
  | 'segments'
  | 'audio'
  | 'video'
  | 'metadata'
  | 'analytics'
  | 'logs';

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
    audioTake: 1,
    audioCreatedAt: null,
    previousTake: null,
    whisperTranscriptPath: `tmp/whisper/${id}-${speakerId}.txt`,
    status: 'pending',
    verification: {
      status: 'pending',
      attempts: 0,
      lastError: null,
      transcriptPreview: null,
    },
    flagged: false,
  };
}

export function useStoryWorkspace(slug: string) {
  const [detail, setDetail] = useState<StoryDetail | null>(null);
  const [loadError, setLoadError] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [storyText, setStoryText] = useState<string>('');
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [segments, setSegments] = useState<SegmentRecord[]>([]);
  const [videoPlan, setVideoPlan] = useState<VideoPlanFile | null>(null);
  const [youtubeMetadata, setYoutubeMetadata] = useState<YoutubeMetadataFile | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jobLog, setJobLog] = useState<string>('');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  // Unsaved local edits must survive the 3s polling refresh; each flag blocks
  // the server snapshot from overwriting that piece of state until saved.
  const dirtyRef = useRef({
    story: false,
    characters: false,
    segments: false,
    videoPlan: false,
    youtubeMetadata: false,
  });
  // Mirrors dirtyRef for the UI (refs don't trigger re-renders).
  const [dirty, setDirty] = useState({
    story: false,
    characters: false,
    segments: false,
    videoPlan: false,
    youtubeMetadata: false,
  });
  type DirtyKey = 'story' | 'characters' | 'segments' | 'videoPlan' | 'youtubeMetadata';
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
      if (!dirtyRef.current.videoPlan) {
        setVideoPlan(nextDetail.videoPlan);
      }
      if (!dirtyRef.current.youtubeMetadata) {
        setYoutubeMetadata(nextDetail.youtubeMetadata);
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

  // playerIndex is a plain index into playableSegments, which is recomputed
  // whenever segments changes (e.g. a background job flips a segment's
  // eligibility mid-playback). If the array reshuffles while the index
  // itself doesn't change, that index now points at a different segment —
  // relocate the segment actually being played instead of silently jumping.
  const playerSyncRef = useRef<{ index: number | null; id: string | null }>({
    index: null,
    id: null,
  });
  useEffect(() => {
    if (playerIndex === null) {
      playerSyncRef.current = { index: null, id: null };
      return;
    }
    const last = playerSyncRef.current;
    if (last.index === playerIndex && last.id !== null) {
      const currentId = playableSegments[playerIndex]?.id ?? null;
      if (currentId !== last.id) {
        const correctedIndex = playableSegments.findIndex((segment) => segment.id === last.id);
        setPlayerIndex(correctedIndex >= 0 ? correctedIndex : null);
        return;
      }
    }
    playerSyncRef.current = { index: playerIndex, id: playableSegments[playerIndex]?.id ?? null };
  }, [playableSegments, playerIndex]);

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
  const finalAudioApproval = detail?.story.approvals.finalAudio.status ?? 'pending';
  const hasActiveJob = detail?.activeJob !== null && detail?.activeJob !== undefined;
  const isArchived = detail?.story.archived ?? false;
  const canProcess = storyText.trim().length > 0 && !hasActiveJob && !isArchived;
  const canGenerate = segmentApproval === 'approved' && voicesReady && !hasActiveJob && !isArchived;
  const canConfirmVerified = allVerified && !hasActiveJob && !isArchived;
  const canConcat = verifiedApproval === 'approved' && !hasActiveJob && !isArchived;
  // Full validation (catalog ids resolve, intro image exists, etc.) happens
  // server-side in assertCanStartJob — this is just enough to keep the
  // button in a sane disabled state before that round trip.
  const canRenderVideo =
    finalAudioApproval === 'approved' &&
    Boolean(videoPlan?.introImagePath) &&
    Boolean(videoPlan?.sceneVideoId) &&
    !hasActiveJob &&
    !isArchived;
  // Metadata generation only needs the story text (videoDurationMs is
  // optional context for the prompt, fine as null this early) — it can run
  // at any point in the pipeline, independent of audio/video approval.
  const canGenerateMetadata = !isBusy && !isArchived;

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

  const stopJob = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      await storiesApi.stopJob(slug);
    }, 'Stop requested — the job will finish its current segment and exit.');
  }, [runAction, slug]);

  const saveStory = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      await storiesApi.saveStoryText(slug, storyText);
      clearDirty('story');
    }, 'Story saved.');
  }, [clearDirty, runAction, slug, storyText]);

  const saveCharacters = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      const result = await storiesApi.saveCharacters(slug, { characters });
      clearDirty('characters');
      if (result.droppedCount > 0) {
        toast.warning(
          `${result.droppedCount} character(s) with a blank name or id were dropped — give ` +
            'them a name before saving to keep them.',
        );
      }
    }, 'Characters saved.');
  }, [characters, clearDirty, runAction, slug]);

  const saveSegments = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      const result = await storiesApi.saveSegments(slug, { segments });
      clearDirty('segments');
      if (result.droppedCount > 0) {
        toast.warning(
          `${result.droppedCount} segment(s) with blank text were dropped — fill them in ` +
            'before saving to keep them.',
        );
      }
    }, 'Segments saved.');
  }, [clearDirty, runAction, segments, slug]);

  // Flag toggling persists immediately through its own endpoint (instead of
  // routing through markDirty/saveSegments) because the full segments PUT
  // resets the story's approval status — a flag is just a review note and
  // shouldn't invalidate already-approved segments/audio.
  const toggleSegmentFlag = useCallback(
    async (segmentId: string): Promise<void> => {
      const target = segments.find((segment) => segment.id === segmentId);
      if (!target) {
        return;
      }
      const flagged = !target.flagged;
      setSegments((current) =>
        current.map((segment) => (segment.id === segmentId ? { ...segment, flagged } : segment)),
      );
      try {
        await storiesApi.setSegmentFlag(slug, segmentId, flagged);
      } catch (error) {
        setSegments((current) =>
          current.map((segment) =>
            segment.id === segmentId ? { ...segment, flagged: !flagged } : segment,
          ),
        );
        toast.error(error instanceof Error ? error.message : 'Could not update flag');
      }
    },
    [segments, slug],
  );

  // Unlike flag toggling, this changes which audio file is "current" — the
  // server derives the resulting status/verification from the take being
  // switched to, so the fresh segments come back through refresh() rather
  // than being predicted optimistically here.
  const selectSegmentTake = useCallback(
    async (segmentId: string): Promise<void> => {
      await runAction(async () => {
        await storiesApi.selectSegmentTake(slug, segmentId);
      }, 'Switched audio take.');
    },
    [runAction, slug],
  );

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

  const revealFinalAudio = useCallback(async (): Promise<void> => {
    await runAction(() => storiesApi.revealFinalAudio(slug));
  }, [runAction, slug]);

  const updateVideoPlan = useCallback((patch: Partial<VideoPlanFile>): void => {
    markDirty('videoPlan');
    setVideoPlan((current) => (current ? { ...current, ...patch } : current));
  }, [markDirty]);

  const saveVideoPlan = useCallback(async (): Promise<void> => {
    if (!videoPlan) {
      return;
    }
    await runAction(async () => {
      const saved = await storiesApi.saveVideoPlan(slug, videoPlan);
      setVideoPlan(saved);
      clearDirty('videoPlan');
    }, 'Video plan saved.');
  }, [clearDirty, runAction, slug, videoPlan]);

  const randomizeVideoPlan = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      const next = await storiesApi.randomizeVideoPlan(slug);
      setVideoPlan(next);
      clearDirty('videoPlan');
    }, 'Picked new media for this story — Render when ready.');
  }, [clearDirty, runAction, slug]);

  const resetVideoPlanGain = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      const next = await storiesApi.resetVideoPlanGain(slug);
      setVideoPlan(next);
      clearDirty('videoPlan');
    }, 'Đã đồng bộ lại gain từ media library.');
  }, [clearDirty, runAction, slug]);

  const uploadIntroImage = useCallback(async (file: File): Promise<void> => {
    await runAction(async () => {
      const next = await storiesApi.uploadIntroImage(slug, file);
      setVideoPlan(next);
      clearDirty('videoPlan');
    }, 'Intro image uploaded.');
  }, [clearDirty, runAction, slug]);

  const deleteIntroImage = useCallback(async (): Promise<void> => {
    await runAction(async () => {
      const next = await storiesApi.deleteIntroImage(slug);
      setVideoPlan(next);
      clearDirty('videoPlan');
    });
  }, [clearDirty, runAction, slug]);

  const revealIntroImage = useCallback(async (): Promise<void> => {
    await runAction(() => storiesApi.revealIntroImage(slug));
  }, [runAction, slug]);

  const approveFinalVideo = useCallback(async (): Promise<void> => {
    await runAction(
      () => storiesApi.approveFinalVideo(slug),
      'Final video approved. This story is complete.',
    );
  }, [runAction, slug]);

  const revealFinalVideo = useCallback(async (): Promise<void> => {
    await runAction(() => storiesApi.revealFinalVideo(slug));
  }, [runAction, slug]);

  const selectVideoRender = useCallback(
    async (jobId: string): Promise<void> => {
      await runAction(
        async () => {
          await storiesApi.selectVideoRender(slug, jobId);
        },
        'Đã chuyển sang bản render này. Cần duyệt lại video trước khi hoàn tất.',
      );
    },
    [runAction, slug],
  );

  const deleteVideoRender = useCallback(
    async (jobId: string): Promise<void> => {
      await runAction(() => storiesApi.deleteVideoRender(slug, jobId), 'Đã xoá bản render.');
    },
    [runAction, slug],
  );

  const updateYoutubeMetadata = useCallback(
    (patch: Partial<YoutubeMetadataFile>): void => {
      markDirty('youtubeMetadata');
      setYoutubeMetadata((current) => (current ? { ...current, ...patch } : current));
    },
    [markDirty],
  );

  // Metadata edits auto-save (no manual Save/Approve step) — debounce so
  // every keystroke doesn't fire its own request, and avoid runAction/isBusy
  // here since that would disable the metadata inputs mid-typing.
  const metadataAutoSaveTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty.youtubeMetadata || !youtubeMetadata) {
      return;
    }
    if (metadataAutoSaveTimerRef.current) {
      window.clearTimeout(metadataAutoSaveTimerRef.current);
    }
    metadataAutoSaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const saved = await storiesApi.saveYoutubeMetadata(slug, youtubeMetadata);
          setYoutubeMetadata(saved);
          clearDirty('youtubeMetadata');
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Không thể tự động lưu metadata.');
        }
      })();
    }, 800);
    return () => {
      if (metadataAutoSaveTimerRef.current) {
        window.clearTimeout(metadataAutoSaveTimerRef.current);
      }
    };
  }, [clearDirty, dirty.youtubeMetadata, slug, youtubeMetadata]);

  const generateYoutubeMetadata = useCallback(
    async (fields?: YoutubeMetadataFieldGroup[]): Promise<void> => {
      await runAction(async () => {
        const next = await storiesApi.generateYoutubeMetadata(slug, fields);
        setYoutubeMetadata(next);
        clearDirty('youtubeMetadata');
      }, fields ? 'Đã regenerate phần đã chọn.' : 'Đã generate metadata YouTube.');
    },
    [clearDirty, runAction, slug],
  );

  const syncFromLibrary = useCallback(async (): Promise<void> => {
    await runAction(
      () => storiesApi.syncFromLibrary(slug),
      'Đã đồng bộ lại nội dung từ Thư viện. Tiến độ duyệt đã được reset về draft.',
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
  // Depend on the job id (a stable primitive), not the activeJob object —
  // `detail` is a new object on every 3s poll, so depending on the object
  // itself tears this interval down and restarts it every poll, collapsing
  // its 2s cadence into the outer 3s one before it ever fires twice.
  const activeJobId = detail?.activeJob?.id ?? null;
  useEffect(() => {
    if (!activeJobId || activeJobId !== selectedJobId) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadJobLog(selectedJobId);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [activeJobId, loadJobLog, selectedJobId]);

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
    videoPlan,
    videoRenders: detail?.videoRenders ?? [],
    youtubeMetadata,
    selectedJobId,
    selectedJob,
    jobLog,
    isBusy,
    dirty,
    clearDirty,
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
    isArchived,
    canProcess,
    canGenerate,
    canConfirmVerified,
    canConcat,
    canRenderVideo,
    canGenerateMetadata,
    refresh,
    startJob,
    stopJob,
    saveStory,
    saveCharacters,
    saveSegments,
    approveSegments,
    confirmVerifiedAudio,
    approveFinalAudio,
    revealFinalAudio,
    updateVideoPlan,
    saveVideoPlan,
    randomizeVideoPlan,
    resetVideoPlanGain,
    uploadIntroImage,
    deleteIntroImage,
    revealIntroImage,
    approveFinalVideo,
    revealFinalVideo,
    selectVideoRender,
    deleteVideoRender,
    updateYoutubeMetadata,
    generateYoutubeMetadata,
    syncFromLibrary,
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
    toggleSegmentFlag,
    selectSegmentTake,
  };
}

export type StoryWorkspace = ReturnType<typeof useStoryWorkspace>;
