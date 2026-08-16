'use client';

import { Clapperboard, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useConfirm } from '@/components/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mediaApi } from '@/features/stories/api/mediaApi';
import { AppShell } from '@/features/stories/components/AppShell';
import { GradeOverrideEditor } from '@/features/stories/components/GradeOverrideEditor';
import { useVideoGradeConfig } from '@/features/stories/hooks/useVideoGradeConfig';
import { gradeToCssFilter, resolveGrade } from '@/lib/grade';
import type { GradeOverride, MediaAsset, MediaCategory } from '@/types/story';

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
    <Dialog open onOpenChange={(next) => !next && !isBusy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Thêm media</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={category} onValueChange={(value) => setCategory(value as MediaCategory)}>
              <SelectTrigger disabled={isBusy}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Dread drone, chậm"
              disabled={isBusy}
            />
          </div>
          <Label className="flex items-center gap-2">
            <Checkbox checked={loopable} onCheckedChange={(checked) => setLoopable(checked === true)} disabled={isBusy} />
            Loops cleanly (last frame/sample matches the first)
          </Label>
          <div className="grid gap-1.5">
            <Label>File (tải lên qua trình duyệt)</Label>
            <Input type="file" accept="audio/*,video/*" ref={fileInputRef} disabled={isBusy || Boolean(sourcePath.trim())} />
          </div>
          <div className="grid gap-1.5">
            <Label>Hoặc: đường dẫn tuyệt đối file đã có sẵn trên máy</Label>
            <Input
              className="font-mono"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="/Users/ban/Music/rain-ambience.mp3"
              disabled={isBusy}
            />
            <span className="text-xs uppercase tracking-wide text-muted-foreground normal-case">
              Server copy trực tiếp trên đĩa (clone tức thời trên APFS) — không upload qua trình duyệt,
              nhanh hơn nhiều với file lớn/dài. Trình duyệt không cho web đọc path từ ô chọn file (giới
              hạn bảo mật), nên cần dán tay. Mẹo lấy path nhanh trên macOS: chọn file trong Finder, giữ{' '}
              <kbd>Option</kbd> rồi bấm chuột phải → &quot;Copy “...” as Pathname&quot;, sau đó dán vào đây.
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose} disabled={isBusy}>
            Hủy
          </Button>
          <Button type="button" onClick={() => void upload()} disabled={isBusy}>
            <Upload size={16} aria-hidden="true" />
            {isBusy ? 'Đang thêm...' : 'Add to library'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [gradeOverride, setGradeOverride] = useState<GradeOverride>(
    asset.category === 'scene_video' ? asset.gradeOverride : { brightness: null, vignette: null },
  );
  const videoGradeConfig = useVideoGradeConfig();

  // The asset's audio/video class can't change (a scene_video file has no
  // loudness to normalize, an audio file has no frame dimensions) — only
  // offer categories in the same class it was added with.
  const wasAudio = isAudioCategory(asset.category);
  const wasSceneVideo = asset.category === 'scene_video';
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
        ...(wasSceneVideo ? { gradeOverride } : {}),
      });
      toast.success(`Saved "${updated.name}".`);
      onSaved(updated);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Save failed');
    } finally {
      setIsBusy(false);
    }
  }, [
    asset.id,
    category,
    defaultGainDb,
    gradeOverride,
    loopable,
    name,
    notes,
    onClose,
    onSaved,
    source,
    wasAudio,
    wasSceneVideo,
  ]);

  return (
    <Dialog open onOpenChange={(next) => !next && !isBusy && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="font-mono">Sửa {asset.id}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} disabled={isBusy} />
          </div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as MediaCategory)}
              disabled={isBusy || categoryOptions.length < 2}
            >
              <SelectTrigger disabled={isBusy || categoryOptions.length < 2}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {CATEGORY_LABELS[cat]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoryOptions.length < 2 ? (
              <span className="text-xs uppercase tracking-wide text-muted-foreground normal-case">
                Scene video không đổi được nhóm — xoá và thêm lại nếu cần loại khác.
              </span>
            ) : null}
          </div>
          {wasAudio ? (
            <div className="grid gap-1.5">
              <Label>
                Default gain (dB)
                {asset.category !== 'scene_video' && asset.integratedLufs !== null
                  ? ` — đo được ${asset.integratedLufs.toFixed(1)} LUFS`
                  : ' — chưa đo được loudness (dùng giá trị mặc định)'}
              </Label>
              <Input
                type="number"
                step={1}
                value={defaultGainDb}
                onChange={(event) => setDefaultGainDb(Number(event.target.value))}
                disabled={isBusy}
              />
              <span className="text-xs uppercase tracking-wide text-muted-foreground normal-case">
                Mức gain mặc định khi một truyện chọn asset này — chỉnh nếu bạn thấy nó quá to/nhỏ so với
                lời kể. Chỉ áp dụng cho truyện chọn/random lại sau khi lưu; các plan đã lưu trước đó không
                đổi.
              </span>
            </div>
          ) : null}
          {wasSceneVideo && videoGradeConfig ? (
            <GradeOverrideEditor
              title="Hiệu ứng làm tối (grade)"
              value={gradeOverride}
              onChange={setGradeOverride}
              resolved={resolveGrade(videoGradeConfig, gradeOverride, null)}
              previewAssetId={asset.id}
              disabled={isBusy}
            />
          ) : null}
          <Label className="flex items-center gap-2">
            <Checkbox checked={loopable} onCheckedChange={(checked) => setLoopable(checked === true)} disabled={isBusy} />
            Loops cleanly (last frame/sample matches the first)
          </Label>
          <div className="grid gap-1.5">
            <Label>Source</Label>
            <Input value={source} onChange={(event) => setSource(event.target.value)} disabled={isBusy} />
          </div>
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isBusy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={onClose} disabled={isBusy}>
            Hủy
          </Button>
          <Button type="button" onClick={() => void save()} disabled={isBusy}>
            {isBusy ? 'Đang lưu...' : 'Lưu'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const MediaLibraryClient: React.FC = () => {
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState<MediaAsset | null>(null);
  const confirm = useConfirm();
  const videoGradeConfig = useVideoGradeConfig();

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
            <Button type="button" onClick={() => setShowAddModal(true)}>
              <Plus size={16} aria-hidden="true" />
              Thêm media
            </Button>
          </div>
        </div>

        <div className="waveform-divider" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>

        <Card>
          <div className="page-header">
            <h2>
              <Clapperboard size={18} aria-hidden="true" /> Media ({assets.length})
            </h2>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Category</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Default Gain</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
                    No media yet — click &quot;Thêm media&quot; to add background music, rain, intro
                    music, or scene video.
                  </TableCell>
                </TableRow>
              ) : null}
              {assets.map((asset) => (
                <TableRow key={asset.id}>
                  <TableCell>
                    <Badge>{CATEGORY_LABELS[asset.category]}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-mono text-xs">{asset.id}</div>
                    <div>{asset.name}</div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {asset.category !== 'scene_video' ? `${asset.defaultGainDb} dB` : '—'}
                  </TableCell>
                  <TableCell>
                    {asset.category === 'scene_video' ? (
                      <video
                        controls
                        width={180}
                        src={mediaApi.assetUrl(asset.id)}
                        style={
                          videoGradeConfig
                            ? { filter: gradeToCssFilter(resolveGrade(videoGradeConfig, asset.gradeOverride, null)) }
                            : undefined
                        }
                      />
                    ) : (
                      <audio controls src={mediaApi.assetUrl(asset.id)} />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="button-row">
                      <Button variant="secondary" type="button" disabled={isBusy} onClick={() => setEditingAsset(asset)}>
                        <Pencil size={15} aria-hidden="true" />
                      </Button>
                      <Button variant="destructive" type="button" disabled={isBusy} onClick={() => void confirmDelete(asset)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
