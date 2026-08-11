import { Check, Copy, Save, Sparkles } from 'lucide-react';
import React from 'react';
import { toast } from 'react-toastify';

import type { YoutubeMetadataFile } from '@/types/story';

interface MetadataTabProps {
  metadata: YoutubeMetadataFile | null;
  isDirty: boolean;
  isBusy: boolean;
  canGenerate: boolean;
  canApprove: boolean;
  metadataApprovalStatus: 'pending' | 'approved' | 'rejected';
  onUpdate: (patch: Partial<YoutubeMetadataFile>) => void;
  onSave: () => void;
  onGenerate: () => void;
  onApprove: () => void;
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
  <button className="button secondary" type="button" onClick={() => void copyToClipboard(label, value)}>
    <Copy size={14} aria-hidden="true" />
    Copy
  </button>
);

export const MetadataTab: React.FC<MetadataTabProps> = ({
  metadata,
  isDirty,
  isBusy,
  canGenerate,
  canApprove,
  metadataApprovalStatus,
  onUpdate,
  onSave,
  onGenerate,
  onApprove,
}) => {
  if (!metadata) {
    return (
      <section className="panel form">
        <p className="label">Loading metadata...</p>
      </section>
    );
  }

  const isEmpty = metadata.status === 'pending' && metadata.titles.length === 0;

  return (
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>YouTube Metadata</h2>
          <p>
            AI điền phần riêng của truyện (tiêu đề, teaser, tags, thumbnail prompt) — phần khung
            cố định của kênh (intro, disclaimer, CTA, email, copyright, hashtag thương hiệu) không
            bao giờ bị AI viết lại, xem/sửa ở <code>config/templates/youtube-description.txt</code>.
          </p>
        </div>
      </div>

      <div className="button-row">
        <button className="button" type="button" onClick={onGenerate} disabled={!canGenerate || isBusy}>
          <Sparkles size={16} aria-hidden="true" />
          {metadata.status === 'pending' ? 'Generate metadata' : 'Generate lại'}
        </button>
        {!canGenerate ? (
          <span className="label">Cần duyệt verified audio trước khi generate metadata.</span>
        ) : null}
        {metadata.status === 'failed' && metadata.error ? (
          <span className="label">Lỗi lần trước: {metadata.error}</span>
        ) : null}
      </div>

      {isEmpty ? (
        <p className="label">Chưa có metadata — bấm &quot;Generate metadata&quot; ở trên.</p>
      ) : (
        <>
          <div className="panel">
            <h3>Title ({metadata.titles.length} phương án)</h3>
            {metadata.titles.map((title, index) => (
              <label className="field row" key={index}>
                <input
                  type="radio"
                  name="metadata-title"
                  checked={metadata.selectedTitleIndex === index}
                  onChange={() => onUpdate({ selectedTitleIndex: index })}
                  disabled={isBusy}
                />
                <input
                  className="input"
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
              </label>
            ))}
          </div>

          <div className="panel">
            <h3>Description</h3>
            <label className="field">
              <span className="label">Context hook (câu tiếp nối intro 666Hz Radio)</span>
              <textarea
                className="textarea"
                rows={2}
                value={metadata.contextHook}
                onChange={(event) => onUpdate({ contextHook: event.target.value })}
                disabled={isBusy}
              />
            </label>
            <label className="field">
              <span className="label">Teaser (không spoil kết truyện)</span>
              <textarea
                className="textarea"
                rows={8}
                value={metadata.teaser}
                onChange={(event) => onUpdate({ teaser: event.target.value })}
                disabled={isBusy}
              />
            </label>
            <label className="field">
              <span className="label">Description đầy đủ (đã ghép template — copy cái này khi đăng)</span>
              <textarea className="textarea" rows={14} value={metadata.renderedDescription} readOnly />
            </label>
            <div className="button-row">
              <CopyButton label="description" value={metadata.renderedDescription} />
            </div>
          </div>

          <div className="panel">
            <h3>Tags &amp; Category</h3>
            <label className="field">
              <span className="label">Tags (phân cách bởi dấu phẩy)</span>
              <textarea
                className="textarea"
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
            </label>
            <div className="button-row">
              <CopyButton label="tags" value={metadata.tags.join(', ')} />
            </div>
            <label className="field">
              <span className="label">Category</span>
              <input
                className="input"
                type="text"
                value={metadata.category}
                onChange={(event) => onUpdate({ category: event.target.value })}
                disabled={isBusy}
              />
            </label>
          </div>

          <div className="panel">
            <h3>Thumbnail image-gen prompts</h3>
            {metadata.thumbnailPrompts.map((prompt, index) => (
              <label className="field" key={index}>
                <span className="label">Prompt #{index + 1} (tiếng Anh, dán vào Midjourney/DALL-E/etc.)</span>
                <textarea
                  className="textarea"
                  rows={4}
                  value={prompt}
                  onChange={(event) => {
                    const next = [...metadata.thumbnailPrompts];
                    next[index] = event.target.value;
                    onUpdate({ thumbnailPrompts: next });
                  }}
                  disabled={isBusy}
                />
                <div className="button-row">
                  <CopyButton label={`thumbnail prompt #${index + 1}`} value={prompt} />
                </div>
              </label>
            ))}
          </div>

          <div className="panel">
            <h3>Pinned comment</h3>
            <textarea
              className="textarea"
              rows={3}
              value={metadata.pinnedComment}
              onChange={(event) => onUpdate({ pinnedComment: event.target.value })}
              disabled={isBusy}
            />
            <div className="button-row">
              <CopyButton label="pinned comment" value={metadata.pinnedComment} />
            </div>
          </div>

          <div className="button-row">
            <button className="button secondary" type="button" onClick={onSave} disabled={isBusy || !isDirty}>
              <Save size={16} aria-hidden="true" />
              Save
            </button>
            <button className="button" type="button" onClick={onApprove} disabled={!canApprove || isBusy}>
              <Check size={16} aria-hidden="true" />
              Approve metadata
            </button>
            {metadataApprovalStatus === 'approved' ? <span className="badge good">Approved</span> : null}
          </div>
        </>
      )}
    </section>
  );
};

export default MetadataTab;
