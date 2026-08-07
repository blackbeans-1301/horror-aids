import { FileUp, Save, Wand2 } from 'lucide-react';
import React, { useRef } from 'react';

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
    <section className="panel form">
      <div className="page-header">
        <h2>Story Editor</h2>
        {isDirty ? <span className="badge unsaved">Unsaved changes</span> : null}
      </div>
      <textarea
        className="textarea large"
        value={storyText}
        onChange={(event) => onChangeStoryText(event.target.value)}
      />
      <div className="button-row">
        <button className="button" type="button" onClick={onSaveStory} disabled={isBusy}>
          <Save size={16} aria-hidden="true" />
          Save draft
        </button>
        <button className="button secondary" type="button" onClick={onProcessStory} disabled={!canProcess}>
          <Wand2 size={16} aria-hidden="true" />
          Process story
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
        >
          <FileUp size={16} aria-hidden="true" />
          Upload markdown
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          multiple
          hidden
          onChange={(event) => void handleUploadFiles(event)}
        />
      </div>
    </section>
  );
};

export default StoryTab;
