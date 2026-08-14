import { Save, Trash2 } from 'lucide-react';
import React from 'react';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { VoiceOption } from '@/features/stories/api/storiesApi';
import type { CharacterRecord, CharacterRole } from '@/types/story';

const roleOptions: CharacterRole[] = ['narrator', 'main_character', 'side_character', 'villain', 'other'];

// Radix Select.Item forbids an empty-string value, so the "no voice" option
// uses this sentinel internally; it is translated back to '' before it ever
// reaches onUpdateCharacter.
const NO_VOICE_VALUE = '__no_voice__';

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
    <Card>
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
          {isDirty ? <Badge variant="warn">Unsaved changes</Badge> : null}
          <Button variant="secondary" type="button" onClick={onAddCharacter}>
            Add character
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>OmniVoice voice</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {characters.map((character, index) => (
            <TableRow key={`${character.id}-${index}`}>
              <TableCell>
                <Input
                  className="font-mono"
                  value={character.id}
                  onChange={(event) => onUpdateCharacter(index, { id: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <Input
                  value={character.name}
                  onChange={(event) => onUpdateCharacter(index, { name: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <Select
                  value={character.role}
                  onValueChange={(value) => onUpdateCharacter(index, { role: value as CharacterRole })}
                  disabled={character.role === 'narrator'}
                >
                  <SelectTrigger
                    disabled={character.role === 'narrator'}
                    title={character.role === 'narrator' ? 'The narrator role cannot be changed' : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                {voices.length > 0 ? (
                  <Select
                    value={character.voice || NO_VOICE_VALUE}
                    onValueChange={(value) =>
                      onUpdateCharacter(index, { voice: value === NO_VOICE_VALUE ? '' : value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_VOICE_VALUE}>— no voice —</SelectItem>
                      {voices.map((voice) => (
                        <SelectItem key={voice.id} value={voice.id}>
                          {voice.kind === 'clone' ? '🎤 ' : ''}
                          {voice.id}
                          {voice.kind === 'clone' ? ' (cloned)' : ''}
                        </SelectItem>
                      ))}
                      {character.voice && !voices.some((voice) => voice.id === character.voice) ? (
                        <SelectItem value={character.voice}>{character.voice} (unknown)</SelectItem>
                      ) : null}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="font-mono"
                    value={character.voice}
                    onChange={(event) => onUpdateCharacter(index, { voice: event.target.value })}
                    placeholder="omnivoice_voice_id"
                  />
                )}
              </TableCell>
              <TableCell>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => void handleRemove(index)}
                  disabled={character.role === 'narrator'}
                  title={character.role === 'narrator' ? 'The narrator cannot be removed' : `Remove ${character.name}`}
                >
                  <Trash2 size={15} aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button type="button" onClick={onSaveCharacters} disabled={isBusy}>
        <Save size={16} aria-hidden="true" />
        Save characters
      </Button>
    </Card>
  );
};

export default CharactersTab;
