import { Save, Wand2 } from 'lucide-react';
import React from 'react';

interface StoryTabProps {
  storyText: string;
  onChangeStoryText: (value: string) => void;
  onSaveStory: () => void;
  onProcessStory: () => void;
  isBusy: boolean;
  canProcess: boolean;
}

export const StoryTab: React.FC<StoryTabProps> = ({
  storyText,
  onChangeStoryText,
  onSaveStory,
  onProcessStory,
  isBusy,
  canProcess,
}) => {
  return (
    <section className="panel form">
      <h2>Story Editor</h2>
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
      </div>
    </section>
  );
};

export default StoryTab;
