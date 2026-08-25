import { Copy, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { composeThumbnailPrompt, highlightTextLine } from '@/lib/thumbnail-prompt';
import type { YoutubeMetadataFieldGroup, YoutubeMetadataFile } from '@/types/story';

interface MetadataTabProps {
  metadata: YoutubeMetadataFile | null;
  isDirty: boolean;
  isBusy: boolean;
  canGenerate: boolean;
  onUpdate: (patch: Partial<YoutubeMetadataFile>) => void;
  onGenerate: () => void;
  onGenerateField: (field: YoutubeMetadataFieldGroup) => void;
}

async function copyToClipboard(label: string, value: string): Promise<void> {
  if (!value) {
    toast.warning(`${label} đang trống.`);
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`Đã copy ${label}.`);
  } catch {
    toast.error(`Không thể copy ${label} — trình duyệt chặn clipboard.`);
  }
}

const CopyButton: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <Button variant="secondary" size="sm" type="button" onClick={() => void copyToClipboard(label, value)}>
    <Copy size={14} aria-hidden="true" />
    Copy
  </Button>
);

const RegenerateButton: React.FC<{ label: string; isBusy: boolean; onClick: () => void }> = ({
  label,
  isBusy,
  onClick,
}) => (
  <Button variant="secondary" size="sm" type="button" onClick={onClick} disabled={isBusy}>
    <RefreshCw size={14} aria-hidden="true" />
    {label}
  </Button>
);

const DeleteOptionButton: React.FC<{ label: string; disabled: boolean; onClick: () => void }> = ({
  label,
  disabled,
  onClick,
}) => (
  <Button
    variant="destructive"
    size="sm"
    type="button"
    title={disabled ? 'Cần giữ lại ít nhất 1 phương án' : `Xoá ${label}`}
    onClick={onClick}
    disabled={disabled}
  >
    <Trash2 size={14} aria-hidden="true" />
  </Button>
);

// Dropping the currently-selected option falls back to whichever option
// slides into its slot; dropping one before it just shifts the index down
// so the same option stays selected.
function removeAt<T>(list: T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

function selectedIndexAfterRemoval(selectedIndex: number, removedIndex: number): number {
  if (removedIndex < selectedIndex) {
    return selectedIndex - 1;
  }
  if (removedIndex === selectedIndex) {
    return 0;
  }
  return selectedIndex;
}

export const MetadataTab: React.FC<MetadataTabProps> = ({
  metadata,
  isDirty,
  isBusy,
  canGenerate,
  onUpdate,
  onGenerate,
  onGenerateField,
}) => {
  if (!metadata) {
    return (
      <Card className="grid gap-3">
        <p className="label">Loading metadata...</p>
      </Card>
    );
  }

  const isEmpty = metadata.status === 'pending' && metadata.titles.length === 0;
  // Thumbnail prompts are stored without their highlight sentence; it is
  // appended here so a copy always carries whichever title is selected right
  // now, edits included.
  const selectedTitle =
    metadata.titles[metadata.selectedTitleIndex] ?? metadata.titles[0] ?? '';

  return (
    <Card className="grid gap-3">
      <div className="page-header">
        <div>
          <h2>YouTube Metadata</h2>
          <p>
            AI điền phần riêng của truyện (tiêu đề, teaser, tags, thumbnail prompt) — phần khung
            cố định của kênh (intro, disclaimer, CTA, email, copyright, hashtag thương hiệu) không
            bao giờ bị AI viết lại, xem/sửa ở <code>config/templates/youtube-description.txt</code>.
          </p>
        </div>
        <span className="label">{isDirty ? 'Đang tự động lưu...' : 'Đã lưu'}</span>
      </div>

      <div className="button-row">
        <Button type="button" onClick={onGenerate} disabled={!canGenerate || isBusy}>
          <Sparkles size={16} aria-hidden="true" />
          {metadata.status === 'pending' ? 'Generate metadata' : 'Generate lại tất cả'}
        </Button>
        {metadata.status === 'failed' && metadata.error ? (
          <span className="label">Lỗi lần trước: {metadata.error}</span>
        ) : null}
      </div>

      {isEmpty ? (
        <p className="label">Chưa có metadata — bấm &quot;Generate metadata&quot; ở trên.</p>
      ) : (
        <>
          <Card>
            <div className="page-header">
              <CardTitle>Title ({metadata.titles.length} phương án)</CardTitle>
              <RegenerateButton
                label="Regenerate title"
                isBusy={isBusy}
                onClick={() => onGenerateField('titles')}
              />
            </div>
            <RadioGroup
              name="metadata-title"
              value={String(metadata.selectedTitleIndex)}
              onValueChange={(value) => onUpdate({ selectedTitleIndex: Number(value) })}
              disabled={isBusy}
            >
              {metadata.titles.map((title, index) => (
                <div className="field row" key={index}>
                  <RadioGroupItem value={String(index)} id={`metadata-title-${index}`} />
                  <Input
                    type="text"
                    value={title}
                    maxLength={100}
                    onChange={(event) => {
                      const next = [...metadata.titles];
                      next[index] = event.target.value;
                      onUpdate({ titles: next });
                    }}
                    disabled={isBusy}
                  />
                  <CopyButton label={`title #${index + 1}`} value={title} />
                  <DeleteOptionButton
                    label={`title #${index + 1}`}
                    disabled={isBusy || metadata.titles.length <= 1}
                    onClick={() =>
                      onUpdate({
                        titles: removeAt(metadata.titles, index),
                        selectedTitleIndex: selectedIndexAfterRemoval(metadata.selectedTitleIndex, index),
                      })
                    }
                  />
                </div>
              ))}
            </RadioGroup>
          </Card>

          <Card>
            <div className="page-header">
              <CardTitle>Description</CardTitle>
              <RegenerateButton
                label="Regenerate teaser"
                isBusy={isBusy}
                onClick={() => onGenerateField('teaser')}
              />
            </div>
            <div className="field">
              <Label htmlFor="metadata-teaser">Teaser (không spoil kết truyện)</Label>
              <Textarea
                id="metadata-teaser"
                rows={8}
                value={metadata.teaser}
                onChange={(event) => onUpdate({ teaser: event.target.value })}
                disabled={isBusy}
              />
            </div>
            <div className="field">
              <Label htmlFor="metadata-description">
                Description đầy đủ (đã ghép template — copy cái này khi đăng)
              </Label>
              <Textarea id="metadata-description" rows={14} value={metadata.renderedDescription} readOnly />
            </div>
            <div className="button-row">
              <CopyButton label="description" value={metadata.renderedDescription} />
            </div>
          </Card>

          <Card>
            <div className="page-header">
              <CardTitle>Tags &amp; Category</CardTitle>
              <RegenerateButton
                label="Regenerate tags & category"
                isBusy={isBusy}
                onClick={() => onGenerateField('tagsAndCategory')}
              />
            </div>
            <div className="field">
              <Label htmlFor="metadata-tags">Tags (phân cách bởi dấu phẩy)</Label>
              <Textarea
                id="metadata-tags"
                rows={3}
                value={metadata.tags.join(', ')}
                onChange={(event) =>
                  onUpdate({
                    tags: event.target.value
                      .split(',')
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  })
                }
                disabled={isBusy}
              />
            </div>
            <div className="button-row">
              <CopyButton label="tags" value={metadata.tags.join(', ')} />
            </div>
            <div className="field">
              <Label htmlFor="metadata-category">Category</Label>
              <Input
                id="metadata-category"
                type="text"
                value={metadata.category}
                onChange={(event) => onUpdate({ category: event.target.value })}
                disabled={isBusy}
              />
            </div>
          </Card>

          <Card>
            <div className="page-header">
              <CardTitle>Thumbnail image-gen prompts</CardTitle>
              <RegenerateButton
                label="Regenerate thumbnail prompts"
                isBusy={isBusy}
                onClick={() => onGenerateField('thumbnailPrompts')}
              />
            </div>
            <p className="label">
              Mỗi prompt khi copy sẽ tự động kèm câu{' '}
              <code>{highlightTextLine(selectedTitle || '[title đang chọn]')}</code> ở cuối — luôn theo
              đúng title đang được chọn/sửa ở trên, nên không cần tự gõ câu này vào prompt.
            </p>
            {metadata.thumbnailPrompts.map((prompt, index) => (
              <div className="field" key={index}>
                <Label htmlFor={`metadata-thumbnail-prompt-${index}`}>
                  Prompt #{index + 1} (tiếng Anh, dán vào Midjourney/DALL-E/etc.)
                </Label>
                <Textarea
                  id={`metadata-thumbnail-prompt-${index}`}
                  rows={4}
                  value={prompt}
                  onChange={(event) => {
                    const next = [...metadata.thumbnailPrompts];
                    next[index] = event.target.value;
                    onUpdate({ thumbnailPrompts: next });
                  }}
                  disabled={isBusy}
                />
                <p className="label">
                  {selectedTitle ? `+ ${highlightTextLine(selectedTitle)}` : '(chưa có title để highlight)'}
                </p>
                <div className="button-row">
                  <CopyButton
                    label={`thumbnail prompt #${index + 1}`}
                    value={composeThumbnailPrompt(prompt, selectedTitle)}
                  />
                </div>
              </div>
            ))}
          </Card>

          <Card>
            <div className="page-header">
              <CardTitle>Pinned comment ({metadata.pinnedComment.length} phương án)</CardTitle>
              <RegenerateButton
                label="Regenerate pinned comment"
                isBusy={isBusy}
                onClick={() => onGenerateField('pinnedComment')}
              />
            </div>
            <RadioGroup
              name="metadata-pinned-comment"
              value={String(metadata.selectedPinnedCommentIndex)}
              onValueChange={(value) => onUpdate({ selectedPinnedCommentIndex: Number(value) })}
              disabled={isBusy}
            >
              {metadata.pinnedComment.map((comment, index) => (
                <div className="field row" key={index}>
                  <RadioGroupItem value={String(index)} id={`metadata-pinned-comment-${index}`} />
                  <Textarea
                    rows={2}
                    value={comment}
                    onChange={(event) => {
                      const next = [...metadata.pinnedComment];
                      next[index] = event.target.value;
                      onUpdate({ pinnedComment: next });
                    }}
                    disabled={isBusy}
                  />
                  <CopyButton label={`pinned comment #${index + 1}`} value={comment} />
                  <DeleteOptionButton
                    label={`pinned comment #${index + 1}`}
                    disabled={isBusy || metadata.pinnedComment.length <= 1}
                    onClick={() =>
                      onUpdate({
                        pinnedComment: removeAt(metadata.pinnedComment, index),
                        selectedPinnedCommentIndex: selectedIndexAfterRemoval(
                          metadata.selectedPinnedCommentIndex,
                          index,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </RadioGroup>
          </Card>
        </>
      )}
    </Card>
  );
};

export default MetadataTab;
