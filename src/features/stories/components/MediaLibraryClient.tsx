'use client';

import { Clapperboard, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';

import { useConfirm } from '@/components/ConfirmDialog';
import { mediaApi } from '@/features/stories/api/mediaApi';
import { AppShell } from '@/features/stories/components/AppShell';
import type { MediaAsset, MediaCategory } from '@/types/story';

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  bg_music: 'Nhạc nền horror',
  rain_ambience: 'Tiếng mưa nền',
  intro_music: 'Nhạc intro',
  scene_video: 'Video bối cảnh',
};

const CATEGORIES: MediaCategory[] = ['bg_music', 'rain_ambience', 'intro_music', 'scene_video'];
const AUDIO_CATEGORIES: MediaCategory[] = ['bg_music', 'rain_ambience', 'intro_music'];

function isAudioCategory(category: MediaCategory): boolean {
  return category !== 'scene_video';
}

interface AddMediaModalProps {
  onClose: () => void;
  onAdded: () => void;
}

const AddMediaModal: React.FC<AddMediaModalProps> = ({ onClose, onAdded }) => {
  const [isBusy, setIsBusy] = useState(false);
  const [category, setCategory] = useState<MediaCategory>('bg_music');
  const [name, setName] = useState('');
  const [loopable, setLoopable] = useState(true);
  const [sourcePath, setSourcePath] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(async (): Promise<void> => {
    const trimmedPath = sourcePath.trim();
    const file = fileInputRef.current?.files?.[0];
    if (!trimmedPath && !file) {
      toast.error('Choose a file or paste a path first.');
      return;
    }
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }

    setIsBusy(true);
    try {
      const asset = trimmedPath
        ? await mediaApi.upload({ sourcePath: trimmedPath, category, name, loopable })
        : await mediaApi.upload({ file, category, name, loopable });
      toast.success(`Added "${asset.name}" to the ${CATEGORY_LABELS[asset.category]} library.`);
      onAdded();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setIsBusy(false);
    }
  }, [category, loopable, name, onAdded, onClose, sourcePath]);

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !isBusy && onClose()}>
      <div
        className="modal modal-lg panel form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-media-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="page-header">
          <h3 id="add-media-title">Thêm media</h3>
          <button className="button secondary small" type="button" onClick={onClose} disabled={isBusy}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="field">
          <span className="label">Category</span>
          <select
            className="select"
            value={category}
            onChange={(event) => setCategory(event.target.value as MediaCategory)}
            disabled={isBusy}
          >
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Dread drone, chậm" disabled={isBusy} />
        </label>
        <label className="field row">
          <input type="checkbox" checked={loopable} onChange={(event) => setLoopable(event.target.checked)} disabled={isBusy} />
          <span className="label">Loops cleanly (last frame/sample matches the first)</span>
        </label>
        <label className="field">
          <span className="label">File (tải lên qua trình duyệt)</span>
          <input className="input" type="file" accept="audio/*,video/*" ref={fileInputRef} disabled={isBusy || Boolean(sourcePath.trim())} />
        </label>
        <label className="field">
          <span className="label">Hoặc: đường dẫn tuyệt đối file đã có sẵn trên máy</span>
          <input
            className="input mono"
            value={sourcePath}
            onChange={(event) => setSourcePath(event.target.value)}
            placeholder="/Users/ban/Music/rain-ambience.mp3"
            disabled={isBusy}
          />
          <span className="label">
            Server copy trực tiếp trên đĩa (clone tức thời trên APFS) — không upload qua trình duyệt,
            nhanh hơn nhiều với file lớn/dài. Trình duyệt không cho web đọc path từ ô chọn file (giới
            hạn bảo mật), nên cần dán tay. Mẹo lấy path nhanh trên macOS: chọn file trong Finder, giữ{' '}
            <kbd>Option</kbd> rồi bấm chuột phải → &quot;Copy “...” as Pathname&quot;, sau đó dán vào đây.
          </span>
        </label>
        <div className="button-row">
          <button className="button secondary" type="button" onClick={onClose} disabled={isBusy}>
            Hủy
          </button>
          <button className="button" type="button" onClick={() => void upload()} disabled={isBusy}>
            <Upload size={16} aria-hidden="true" />
            {isBusy ? 'Đang thêm...' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface EditMediaModalProps {
  asset: MediaAsset;
  onClose: () => void;
  onSaved: (asset: MediaAsset) => void;
}

const EditMediaModal: React.FC<EditMediaModalProps> = ({ asset, onClose, onSaved }) => {
  const [isBusy, setIsBusy] = useState(false);
  const [name, setName] = useState(asset.name);
  const [category, setCategory] = useState<MediaCategory>(asset.category);
  const [source, setSource] = useState(asset.source);
  const [notes, setNotes] = useState(asset.notes);
  const [loopable, setLoopable] = useState(asset.loopable);
  const [defaultGainDb, setDefaultGainDb] = useState(
    asset.category !== 'scene_video' ? asset.defaultGainDb : 0,
  );

  // The asset's audio/video class can't change (a scene_video file has no
  // loudness to normalize, an audio file has no frame dimensions) — only
  // offer categories in the same class it was added with.
  const wasAudio = isAudioCategory(asset.category);
  const categoryOptions = wasAudio ? AUDIO_CATEGORIES : ['scene_video' as const];

  const save = useCallback(async (): Promise<void> => {
    if (!name.trim()) {
      toast.error('Name is required.');
      return;
    }
    setIsBusy(true);
    try {
      const updated = await mediaApi.update(asset.id, {
        name,
        category,
        source,
        notes,
        loopable,
        ...(wasAudio ? { defaultGainDb } : {}),
      });
      toast.success(`Saved "${updated.name}".`);
      onSaved(updated);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [asset.id, category, defaultGainDb, loopable, name, notes, onClose, onSaved, source, wasAudio]);

  return (
    <div className="modal-overlay" role="presentation" onClick={() => !isBusy && onClose()}>
      <div
        className="modal modal-lg panel form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-media-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="page-header">
          <h3 id="edit-media-title" className="mono">
            Sửa {asset.id}
          </h3>
          <button className="button secondary small" type="button" onClick={onClose} disabled={isBusy}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <label className="field">
          <span className="label">Name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={isBusy} />
        </label>
        <label className="field">
          <span className="label">Category</span>
          <select
            className="select"
            value={category}
            onChange={(event) => setCategory(event.target.value as MediaCategory)}
            disabled={isBusy || categoryOptions.length < 2}
          >
            {categoryOptions.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          {categoryOptions.length < 2 ? (
            <span className="label">Scene video không đổi được nhóm — xoá và thêm lại nếu cần loại khác.</span>
          ) : null}
        </label>
        {wasAudio ? (
          <label className="field">
            <span className="label">
              Default gain (dB)
              {asset.category !== 'scene_video' && asset.integratedLufs !== null
                ? ` — đo được ${asset.integratedLufs.toFixed(1)} LUFS`
                : ' — chưa đo được loudness (dùng giá trị mặc định)'}
            </span>
            <input
              className="input"
              type="number"
              step={1}
              value={defaultGainDb}
              onChange={(event) => setDefaultGainDb(Number(event.target.value))}
              disabled={isBusy}
            />
            <span className="label">
              Mức gain mặc định khi một truyện chọn asset này — chỉnh nếu bạn thấy nó quá to/nhỏ so với
              lời kể. Chỉ áp dụng cho truyện chọn/random lại sau khi lưu; các plan đã lưu trước đó không
              đổi.
            </span>
          </label>
        ) : null}
        <label className="field row">
          <input type="checkbox" checked={loopable} onChange={(event) => setLoopable(event.target.checked)} disabled={isBusy} />
          <span className="label">Loops cleanly (last frame/sample matches the first)</span>
        </label>
        <label className="field">
          <span className="label">Source</span>
          <input className="input" value={source} onChange={(event) => setSource(event.target.value)} disabled={isBusy} />
        </label>
        <label className="field">
          <span className="label">Notes</span>
          <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isBusy} />
        </label>
        <div className="button-row">
          <button className="button secondary" type="button" onClick={onClose} disabled={isBusy}>
            Hủy
          </button>
          <button className="button" type="button" onClick={() => void save()} disabled={isBusy}>
            {isBusy ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const MediaLibraryClient: React.FC = () => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const confirm = useConfirm();

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const media = await mediaApi.list();
      setAssets(media);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load media library');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeAsset = useCallback(
    async (asset: MediaAsset, force = false): Promise<void> => {
      setIsBusy(true);
      try {
        await mediaApi.remove(asset.id, force);
        toast.success(`Deleted ${asset.id}.`);
        await refresh();
      } catch (error) {
        const referencedBy = (error as Error & { referencedBy?: string[] }).referencedBy;
        if (referencedBy?.length) {
          const confirmed = await confirm({
            title: 'Media is in use',
            description:
              `"${asset.name}" is referenced by ${referencedBy.length} story video plan(s): ` +
              `${referencedBy.join(', ')}. Delete anyway? Those plans will fail to render until ` +
              'a replacement is picked.',
            confirmLabel: 'Delete anyway',
            danger: true,
          });
          if (confirmed) {
            await removeAsset(asset, true);
          }
          return;
        }
        toast.error(error instanceof Error ? error.message : 'Delete failed');
      } finally {
        setIsBusy(false);
      }
    },
    [confirm, refresh],
  );

  const confirmDelete = useCallback(
    async (asset: MediaAsset): Promise<void> => {
      const confirmed = await confirm({
        title: 'Delete media asset?',
        description: `Delete "${asset.name}" (${asset.id})? Any story plan using it will need a replacement.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (confirmed) {
        await removeAsset(asset);
      }
    },
    [confirm, removeAsset],
  );

  return (
    <AppShell>
      <main className="page">
        <div className="page-header">
          <div>
            <div className="eyebrow">Media Library</div>
            <h1>Background Music, Rain, Intro Music &amp; Scene Video</h1>
            <p>Reusable assets the video-assembly stage picks from for every story.</p>
          </div>
          <div className="button-row">
            <button className="button" type="button" onClick={() => setShowAddModal(true)}>
              <Plus size={16} aria-hidden="true" />
              Thêm media
            </button>
          </div>
        </div>

        <div className="waveform-divider" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>

        <section className="panel">
          <div className="page-header">
            <h2>
              <Clapperboard size={18} aria-hidden="true" /> Media ({assets.length})
            </h2>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Name</th>
                  <th>Default Gain</th>
                  <th>Preview</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="label">
                      No media yet — click &quot;Thêm media&quot; to add background music, rain, intro
                      music, or scene video.
                    </td>
                  </tr>
                ) : null}
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <span className="badge">{CATEGORY_LABELS[asset.category]}</span>
                    </td>
                    <td>
                      <div className="mono">{asset.id}</div>
                      <div>{asset.name}</div>
                    </td>
                    <td className="mono">{asset.category !== 'scene_video' ? `${asset.defaultGainDb} dB` : '—'}</td>
                    <td>
                      {asset.category === 'scene_video' ? (
                        <video controls width={180} src={mediaApi.assetUrl(asset.id)} />
                      ) : (
                        <audio controls src={mediaApi.assetUrl(asset.id)} />
                      )}
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button secondary"
                          type="button"
                          disabled={isBusy}
                          onClick={() => setEditingAsset(asset)}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </button>
                        <button
                          className="button danger"
                          type="button"
                          disabled={isBusy}
                          onClick={() => void confirmDelete(asset)}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {showAddModal ? (
        <AddMediaModal onClose={() => setShowAddModal(false)} onAdded={() => void refresh()} />
      ) : null}
      {editingAsset ? (
        <EditMediaModal
          asset={editingAsset}
          onClose={() => setEditingAsset(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
    </AppShell>
  );
};

export default MediaLibraryClient;
