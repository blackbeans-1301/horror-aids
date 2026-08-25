import { FileUp, Save, Wand2 } from 'lucide-react';
import React, { useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { readStoryFilesAsText } from '@/features/stories/utils/readStoryFiles';

interface StoryTabProps {
  storyText: string;
  onChangeStoryText: (value: string) => void;
  onSaveStory: () => void;
  onProcessStory: () => void;
  isBusy: boolean;
  canProcess: boolean;
  isDirty: boolean;
}

export const StoryTab: React.FC<StoryTabProps> = ({
  storyText,
  onChangeStoryText,
  onSaveStory,
  onProcessStory,
  isBusy,
  canProcess,
  isDirty,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleUploadFiles = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }
    const text = await readStoryFilesAsText(files);
    onChangeStoryText(text);
    event.target.value = '';
  };

  return (
    <Card className="grid gap-3">
      <div className="page-header">
        <h2>Story Editor</h2>
        {isDirty ? <Badge variant="warn">Unsaved changes</Badge> : null}
      </div>
      <Textarea
        className="min-h-[70vh] resize-y"
        value={storyText}
        onChange={(event) => onChangeStoryText(event.target.value)}
      />
      <div className="button-row sticky bottom-0 z-10 -mx-[18px] -mb-[18px] border-t border-border bg-card px-[18px] py-3">
        <Button type="button" onClick={onSaveStory} disabled={isBusy}>
          <Save size={16} aria-hidden="true" />
          Save draft
        </Button>
        <Button variant="secondary" type="button" onClick={onProcessStory} disabled={!canProcess}>
          <Wand2 size={16} aria-hidden="true" />
          Process story
        </Button>
        <Button variant="secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
          <FileUp size={16} aria-hidden="true" />
          Upload markdown
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          multiple
          hidden
          onChange={(event) => void handleUploadFiles(event)}
        />
      </div>
    </Card>
  );
};

export default StoryTab;
