import { Check, Save, Trash2 } from 'lucide-react';
import React from 'react';

import type { CharacterRecord, SegmentEmotion, SegmentRecord } from '@/types/story';

interface SegmentsTabProps {
  segments: SegmentRecord[];
  characters: CharacterRecord[];
  voicesReady: boolean;
  isBusy: boolean;
  onUpdateSegment: (index: number, patch: Partial<SegmentRecord>) => void;
  onAddSegment: () => void;
  onInsertSegmentAfter: (index: number) => void;
  onDeleteSegment: (index: number) => void;
  onSplitSegment: (index: number) => void;
  onMergeWithNext: (index: number) => void;
  onSaveSegments: () => void;
  onApproveSegments: () => void;
}

export const SegmentsTab: React.FC<SegmentsTabProps> = ({
  segments,
  characters,
  voicesReady,
  isBusy,
  onUpdateSegment,
  onAddSegment,
  onInsertSegmentAfter,
  onDeleteSegment,
  onSplitSegment,
  onMergeWithNext,
  onSaveSegments,
  onApproveSegments,
}) => {
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
        <button className="button secondary" type="button" onClick={onAddSegment}>
          Add segment
        </button>
      </div>
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
                  <button className="button danger" type="button" onClick={() => onDeleteSegment(index)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="button-row">
        <button className="button secondary" type="button" onClick={onSaveSegments} disabled={isBusy}>
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
      {segments.length > 0 && !voicesReady ? (
        <p className="label">
          Disabled because some speakers have no voice yet. Assign an OmniVoice voice to every used speaker in the Characters tab, then save.
        </p>
      ) : null}
    </section>
  );
};

export default SegmentsTab;
