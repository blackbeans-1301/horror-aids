import { Save, Trash2 } from 'lucide-react';
import React from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import type { VoiceOption } from '@/features/stories/api/storiesApi';
import type { CharacterRecord, CharacterRole } from '@/types/story';

const roleOptions: CharacterRole[] = ['narrator', 'main_character', 'side_character', 'villain', 'other'];

interface CharactersTabProps {
  characters: CharacterRecord[];
  voices: VoiceOption[];
  voicesError: string;
  isBusy: boolean;
  onUpdateCharacter: (index: number, patch: Partial<CharacterRecord>) => void;
  onAddCharacter: () => void;
  onRemoveCharacter: (index: number) => void;
  onSaveCharacters: () => void;
  isDirty: boolean;
}

export const CharactersTab: React.FC<CharactersTabProps> = ({
  characters,
  voices,
  voicesError,
  isBusy,
  onUpdateCharacter,
  onAddCharacter,
  onRemoveCharacter,
  onSaveCharacters,
  isDirty,
}) => {
  const confirm = useConfirm();

  const handleRemove = async (index: number): Promise<void> => {
    const character = characters[index];
    const confirmed = await confirm({
      title: 'Remove character?',
      description: `Remove "${character?.name ?? character?.id}"? Any segments still assigned to this speaker will need a new voice before you can accept them for TTS.`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (confirmed) {
      onRemoveCharacter(index);
    }
  };

  return (
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>Characters And Voices</h2>
          <p>
            Every speaker used by segments needs an OmniVoice voice. Add a cloned voice (🎤) from
            the Settings page by uploading a 3-5s reference clip, then assign it here.
          </p>
          {voicesError ? <p className="label">{voicesError}</p> : null}
        </div>
        <div className="button-row">
          {isDirty ? <span className="badge unsaved">Unsaved changes</span> : null}
          <button className="button secondary" type="button" onClick={onAddCharacter}>
            Add character
          </button>
        </div>
      </div>
      <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>OmniVoice voice</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {characters.map((character, index) => (
            <tr key={`${character.id}-${index}`}>
              <td>
                <input
                  className="input mono"
                  value={character.id}
                  onChange={(event) => onUpdateCharacter(index, { id: event.target.value })}
                />
              </td>
              <td>
                <input
                  className="input"
                  value={character.name}
                  onChange={(event) => onUpdateCharacter(index, { name: event.target.value })}
                />
              </td>
              <td>
                <select
                  className="select"
                  value={character.role}
                  onChange={(event) => onUpdateCharacter(index, { role: event.target.value as CharacterRole })}
                >
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {voices.length > 0 ? (
                  <select
                    className="select"
                    value={character.voice}
                    onChange={(event) => onUpdateCharacter(index, { voice: event.target.value })}
                  >
                    <option value="">— no voice —</option>
                    {voices.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.kind === 'clone' ? '🎤 ' : ''}
                        {voice.id}
                        {voice.kind === 'clone' ? ' (cloned)' : ''}
                      </option>
                    ))}
                    {character.voice && !voices.some((voice) => voice.id === character.voice) ? (
                      <option value={character.voice}>{character.voice} (unknown)</option>
                    ) : null}
                  </select>
                ) : (
                  <input
                    className="input mono"
                    value={character.voice}
                    onChange={(event) => onUpdateCharacter(index, { voice: event.target.value })}
                    placeholder="omnivoice_voice_id"
                  />
                )}
              </td>
              <td>
                <button
                  className="button danger"
                  type="button"
                  onClick={() => void handleRemove(index)}
                  disabled={character.role === 'narrator'}
                  title={character.role === 'narrator' ? 'The narrator cannot be removed' : `Remove ${character.name}`}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <button className="button" type="button" onClick={onSaveCharacters} disabled={isBusy}>
        <Save size={16} aria-hidden="true" />
        Save characters
      </button>
    </section>
  );
};

export default CharactersTab;
