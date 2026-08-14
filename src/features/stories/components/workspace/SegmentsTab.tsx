import { Check, Save, Trash2 } from 'lucide-react';
import React from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
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
    <Card>
      <div className="page-header">
        <div>
          <CardTitle>Segments</CardTitle>
          <p>
            Approve these rows before TTS. Editing them later resets verification. Emotion
            &quot;storytelling&quot; suits narration; &quot;natural&quot; suits dialogue. You can also type
            inline cues in the text: [cười] [thở dài] [hắng giọng].
          </p>
        </div>
        <div className="button-row">
          {isDirty ? <Badge variant="warn">Unsaved changes</Badge> : null}
          <Button variant="secondary" type="button" onClick={onAddSegment}>
            Add segment
          </Button>
          <Button
            variant="secondary"
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
          </Button>
          <Button
            type="button"
            onClick={onApproveSegments}
            disabled={isBusy || segments.length === 0 || !voicesReady}
          >
            <Check size={16} aria-hidden="true" />
            Accept segments for TTS
          </Button>
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Speaker</TableHead>
            <TableHead>Text</TableHead>
            <TableHead>Emotion</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.map((segment, index) => (
            <TableRow key={`${segment.id}-${index}`}>
              <TableCell className="mono">{segment.order}</TableCell>
              <TableCell>
                <Select
                  value={segment.speakerId}
                  onValueChange={(value) => onUpdateSegment(index, { speakerId: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {characters.map((character) => (
                      <SelectItem key={character.id} value={character.id}>
                        {character.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Textarea
                  value={segment.text}
                  onChange={(event) => onUpdateSegment(index, { text: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <Select
                  value={segment.emotion ?? 'natural'}
                  onValueChange={(value) => onUpdateSegment(index, { emotion: value as SegmentEmotion })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="natural">natural</SelectItem>
                    <SelectItem value="storytelling">storytelling</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Badge>{segment.status}</Badge>
              </TableCell>
              <TableCell>
                <div className="button-row">
                  <Button
                    variant="secondary"
                    type="button"
                    title="Insert a new segment below this one"
                    onClick={() => onInsertSegmentAfter(index)}
                  >
                    + Below
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => onSplitSegment(index)}>
                    Split
                  </Button>
                  <Button variant="secondary" type="button" onClick={() => onMergeWithNext(index)}>
                    Merge
                  </Button>
                  <Button variant="destructive" type="button" onClick={() => void handleDelete(index)}>
                    <Trash2 size={15} aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
};

export default SegmentsTab;
