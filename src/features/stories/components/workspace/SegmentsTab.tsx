import { Check, Save, Trash2 } from 'lucide-react';
import React from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import type { CharacterRecord, SegmentEmotion, SegmentRecord } from '@/types/story';

interface SegmentsTabProps {
  segments: SegmentRecord[];
  characters: CharacterRecord[];
  voicesReady: boolean;
  isBusy: boolean;
  hasActiveJob: boolean;
  onUpdateSegment: (index: number, patch: Partial<SegmentRecord>) => void;
  onAddSegment: () => void;
  onInsertSegmentAfter: (index: number) => void;
  onDeleteSegment: (index: number) => void;
  onSplitSegment: (index: number) => void;
  onMergeWithNext: (index: number) => void;
  onSaveSegments: () => void;
  onApproveSegments: () => void;
  isDirty: boolean;
}

export const SegmentsTab: React.FC<SegmentsTabProps> = ({
  segments,
  characters,
  voicesReady,
  isBusy,
  hasActiveJob,
  onUpdateSegment,
  onAddSegment,
  onInsertSegmentAfter,
  onDeleteSegment,
  onSplitSegment,
  onMergeWithNext,
  onSaveSegments,
  onApproveSegments,
  isDirty,
}) => {
  const confirm = useConfirm();

  const handleDelete = async (index: number): Promise<void> => {
    const segment = segments[index];
    const confirmed = await confirm({
      title: 'Delete segment?',
      description: `Delete segment ${segment?.order ?? index + 1}? This removes its text and any generated audio once you save.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (confirmed) {
      onDeleteSegment(index);
    }
  };

  return (
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>Segments</h2>
          <p>
            Approve these rows before TTS. Editing them later resets verification. Emotion
            &quot;storytelling&quot; suits narration; &quot;natural&quot; suits dialogue. You can also type
            inline cues in the text: [cười] [thở dài] [hắng giọng].
          </p>
        </div>
        <div className="button-row">
          {isDirty ? <span className="badge unsaved">Unsaved changes</span> : null}
          <button className="button secondary" type="button" onClick={onAddSegment}>
            Add segment
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={onSaveSegments}
            disabled={isBusy || hasActiveJob}
            title={
              hasActiveJob
                ? 'A TTS job is running for this story — wait for it to finish (or stop it) before saving segment edits'
                : undefined
            }
          >
            <Save size={16} aria-hidden="true" />
            Save segments
          </button>
          <button
            className="button"
            type="button"
            onClick={onApproveSegments}
            disabled={isBusy || segments.length === 0 || !voicesReady}
          >
            <Check size={16} aria-hidden="true" />
            Accept segments for TTS
          </button>
        </div>
      </div>
      {segments.length > 0 && !voicesReady ? (
        <p className="label">
          Disabled because some speakers have no voice yet. Assign an OmniVoice voice to every used speaker in the Characters tab, then save.
        </p>
      ) : null}
      {hasActiveJob ? (
        <p className="label">
          A TTS job is running for this story — saving is disabled until it finishes (or you stop
          it), so edits made mid-run don&apos;t end up out of sync with audio it just generated.
        </p>
      ) : null}
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Speaker</th>
            <th>Text</th>
            <th>Emotion</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {segments.map((segment, index) => (
            <tr key={`${segment.id}-${index}`}>
              <td className="mono">{segment.order}</td>
              <td>
                <select
                  className="select"
                  value={segment.speakerId}
                  onChange={(event) => onUpdateSegment(index, { speakerId: event.target.value })}
                >
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <textarea
                  className="textarea"
                  value={segment.text}
                  onChange={(event) => onUpdateSegment(index, { text: event.target.value })}
                />
              </td>
              <td>
                <select
                  className="select"
                  value={segment.emotion ?? 'natural'}
                  onChange={(event) => onUpdateSegment(index, { emotion: event.target.value as SegmentEmotion })}
                >
                  <option value="natural">natural</option>
                  <option value="storytelling">storytelling</option>
                </select>
              </td>
              <td>
                <span className="badge">{segment.status}</span>
              </td>
              <td>
                <div className="button-row">
                  <button
                    className="button secondary"
                    type="button"
                    title="Insert a new segment below this one"
                    onClick={() => onInsertSegmentAfter(index)}
                  >
                    + Below
                  </button>
                  <button className="button secondary" type="button" onClick={() => onSplitSegment(index)}>
                    Split
                  </button>
                  <button className="button secondary" type="button" onClick={() => onMergeWithNext(index)}>
                    Merge
                  </button>
                  <button className="button danger" type="button" onClick={() => void handleDelete(index)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  );
};

export default SegmentsTab;
