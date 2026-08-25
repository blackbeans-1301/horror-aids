import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, Save, Trash2 } from 'lucide-react';
import React, { useRef } from 'react';

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

interface SegmentRowProps {
  segment: SegmentRecord;
  index: number;
  characters: CharacterRecord[];
  onUpdateSegment: (index: number, patch: Partial<SegmentRecord>) => void;
  onInsertSegmentAfter: (index: number) => void;
  onSplitSegment: (index: number) => void;
  onMergeWithNext: (index: number) => void;
  onDeleteSegment: (index: number) => void;
}

// Memoized so editing one segment (a new segments array reference every
// keystroke) only re-renders the row whose own props actually changed —
// see useStoryWorkspace's updateSegment, which preserves object identity
// for every other segment in the array.
const SegmentRow = React.memo(
  React.forwardRef<HTMLTableRowElement, SegmentRowProps & { 'data-index': number }>(
    function SegmentRow(
      {
        segment,
        index,
        characters,
        onUpdateSegment,
        onInsertSegmentAfter,
        onSplitSegment,
        onMergeWithNext,
        onDeleteSegment,
        ...rest
      },
      ref,
    ) {
      const confirm = useConfirm();

      const handleDelete = async (): Promise<void> => {
        const confirmed = await confirm({
          title: 'Delete segment?',
          description: `Delete segment ${segment.order}? This removes its text and any generated audio once you save.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (confirmed) {
          onDeleteSegment(index);
        }
      };

      return (
        <TableRow ref={ref} {...rest}>
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
              className="min-h-[120px] resize-y"
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
              <Button variant="destructive" type="button" onClick={() => void handleDelete()}>
                <Trash2 size={15} aria-hidden="true" />
              </Button>
            </div>
          </TableCell>
        </TableRow>
      );
    },
  ),
);
SegmentRow.displayName = 'SegmentRow';

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
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Rows vary in height (multi-line text, manual textarea resize), so we
  // measure each mounted row and only keep ~15-20 in the DOM at a time
  // instead of all 300-400 — that's what makes this table usable at scale.
  const rowVirtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 176,
    overscan: 6,
    getItemKey: (index) => segments[index]?.id ?? index,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - virtualItems[virtualItems.length - 1].end : 0;

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
      <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
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
            {paddingTop > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={6} style={{ height: paddingTop, padding: 0, border: 0 }} />
              </tr>
            ) : null}
            {virtualItems.map((virtualItem) => {
              const segment = segments[virtualItem.index];
              if (!segment) {
                return null;
              }
              return (
                <SegmentRow
                  key={segment.id}
                  data-index={virtualItem.index}
                  ref={rowVirtualizer.measureElement}
                  segment={segment}
                  index={virtualItem.index}
                  characters={characters}
                  onUpdateSegment={onUpdateSegment}
                  onInsertSegmentAfter={onInsertSegmentAfter}
                  onSplitSegment={onSplitSegment}
                  onMergeWithNext={onMergeWithNext}
                  onDeleteSegment={onDeleteSegment}
                />
              );
            })}
            {paddingBottom > 0 ? (
              <tr aria-hidden="true">
                <td colSpan={6} style={{ height: paddingBottom, padding: 0, border: 0 }} />
              </tr>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
};

export default SegmentsTab;
