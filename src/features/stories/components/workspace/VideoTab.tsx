import {
  Check,
  Clapperboard,
  Dice5,
  Download,
  FolderOpen,
  History,
  Image as ImageIcon,
  Save,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { mediaApi } from '@/features/stories/api/mediaApi';
import { GradeOverrideEditor } from '@/features/stories/components/GradeOverrideEditor';
import { useVideoGradeConfig } from '@/features/stories/hooks/useVideoGradeConfig';
import { assetUrl } from '@/features/stories/utils/asset';
import { formatLongDuration } from '@/features/stories/utils/format';
import { resolveGrade } from '@/lib/grade';
import type { MediaAsset, MediaCategory, VideoPlanFile, VideoRenderSummary } from '@/types/story';

interface VideoTabProps {
  slug: string;
  videoPlan: VideoPlanFile | null;
  videoRenders: VideoRenderSummary[];
  isDirty: boolean;
  isBusy: boolean;
  canRenderVideo: boolean;
  finalVideoExists: boolean;
  finalVideoPath: string;
  onUpdatePlan: (patch: Partial<VideoPlanFile>) => void;
  onSavePlan: () => void;
  onRandomize: () => void;
  onResetGain: () => void;
  onUploadIntroImage: (file: File) => void;
  onDeleteIntroImage: () => void;
  onStartRender: () => void;
  onApproveFinalVideo: () => void;
  onRevealFinalVideo: () => void;
  onSelectRender: (jobId: string) => void;
  onDeleteRender: (jobId: string) => void;
}

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  bg_music: 'Nhạc nền horror',
  rain_ambience: 'Tiếng mưa nền',
  intro_music: 'Nhạc intro',
  scene_video: 'Video bối cảnh',
};

// Radix's SelectItem throws if given an empty-string value, so the "none
// picked" option needs a non-empty sentinel — translated back to null right
// at the AssetSelect boundary, never leaking into onChange/onUpdatePlan.
const NONE_VALUE = '__none__';

function useMediaByCategory(): Record<MediaCategory, MediaAsset[]> {
  const [byCategory, setByCategory] = useState<Record<MediaCategory, MediaAsset[]>>({
    bg_music: [],
    rain_ambience: [],
    intro_music: [],
    scene_video: [],
  });

  useEffect(() => {
    void mediaApi.list().then((media) => {
      setByCategory({
        bg_music: media.filter((asset) => asset.category === 'bg_music'),
        rain_ambience: media.filter((asset) => asset.category === 'rain_ambience'),
        intro_music: media.filter((asset) => asset.category === 'intro_music'),
        scene_video: media.filter((asset) => asset.category === 'scene_video'),
      });
    });
  }, []);

  return byCategory;
}

const AssetSelect: React.FC<{
  category: MediaCategory;
  options: MediaAsset[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled: boolean;
  required?: boolean;
}> = ({ category, options, value, onChange, disabled, required }) => (
  <div className="grid gap-1.5">
    <Label>
      {CATEGORY_LABELS[category]}
      {required ? ' *' : ' (tùy chọn)'}
    </Label>
    <Select
      value={value ?? NONE_VALUE}
      onValueChange={(next) => onChange(next === NONE_VALUE ? null : next)}
      disabled={disabled}
    >
      <SelectTrigger disabled={disabled}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE_VALUE}>{required ? '— chọn —' : '(không dùng)'}</SelectItem>
        {options.map((asset) => (
          <SelectItem key={asset.id} value={asset.id}>
            {asset.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    {options.length === 0 ? (
      <span className="label">Chưa có gì trong danh mục này — thêm ở Settings.</span>
    ) : null}
  </div>
);

export const VideoTab: React.FC<VideoTabProps> = ({
  slug,
  videoPlan,
  videoRenders,
  isDirty,
  isBusy,
  canRenderVideo,
  finalVideoExists,
  finalVideoPath,
  onUpdatePlan,
  onSavePlan,
  onRandomize,
  onResetGain,
  onUploadIntroImage,
  onDeleteIntroImage,
  onStartRender,
  onApproveFinalVideo,
  onRevealFinalVideo,
  onSelectRender,
  onDeleteRender,
}) => {
  const mediaByCategory = useMediaByCategory();
  const videoGradeConfig = useVideoGradeConfig();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!videoPlan) {
    return (
      <Card className="grid gap-3">
        <p className="label">Loading video plan...</p>
      </Card>
    );
  }

  const selectedSceneAsset = mediaByCategory.scene_video.find((asset) => asset.id === videoPlan.sceneVideoId);
  const sceneAssetGradeOverride =
    selectedSceneAsset && selectedSceneAsset.category === 'scene_video'
      ? selectedSceneAsset.gradeOverride
      : null;

  const handleChooseIntroImage = (): void => {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error('Choose an image first.');
      return;
    }
    onUploadIntroImage(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className="grid gap-3">
      <div className="page-header">
        <div>
          <h2>Video Assembly</h2>
          <p>
            Formula-based final video: intro image + intro music, then looped scene footage
            under the narration with a music and rain bed mixed underneath.
          </p>
        </div>
      </div>

      <Card>
        <CardTitle>Intro Image (per-story upload)</CardTitle>
        {videoPlan.introImagePath ? (
          <>
            <Image
              src={assetUrl(slug, videoPlan.introImagePath)}
              alt="Intro"
              width={320}
              height={180}
              unoptimized
              style={{ width: 320, height: 180, objectFit: 'cover' }}
            />
            <div className="button-row">
              <Button variant="secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <ImageIcon size={16} aria-hidden="true" />
                Replace
              </Button>
              <Button variant="destructive" type="button" onClick={onDeleteIntroImage} disabled={isBusy}>
                <Trash2 size={16} aria-hidden="true" />
                Remove
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="label">
              Required before rendering — this is the only input that has no library to pick from.
            </p>
            <Button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
              <ImageIcon size={16} aria-hidden="true" />
              Upload intro image
            </Button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleChooseIntroImage}
        />
      </Card>

      <div className="button-row">
        <Button variant="secondary" type="button" onClick={onRandomize} disabled={isBusy}>
          <Dice5 size={16} aria-hidden="true" />
          Random hoá lại
        </Button>
        <span className="label">Tự động chọn nhạc/video nền — đổi lại từng ô dưới đây nếu cần.</span>
      </div>

      <AssetSelect
        category="scene_video"
        required
        options={mediaByCategory.scene_video}
        value={videoPlan.sceneVideoId}
        onChange={(id) => onUpdatePlan({ sceneVideoId: id })}
        disabled={isBusy}
      />
      <AssetSelect
        category="intro_music"
        options={mediaByCategory.intro_music}
        value={videoPlan.introMusicId}
        onChange={(id) => onUpdatePlan({ introMusicId: id })}
        disabled={isBusy}
      />
      <AssetSelect
        category="bg_music"
        options={mediaByCategory.bg_music}
        value={videoPlan.bgMusicId}
        onChange={(id) => onUpdatePlan({ bgMusicId: id })}
        disabled={isBusy}
      />
      <AssetSelect
        category="rain_ambience"
        options={mediaByCategory.rain_ambience}
        value={videoPlan.rainAmbienceId}
        onChange={(id) => onUpdatePlan({ rainAmbienceId: id })}
        disabled={isBusy}
      />

      {videoGradeConfig ? (
        <Card>
          <GradeOverrideEditor
            title="Hiệu ứng làm tối (grade) — riêng cho story này"
            value={videoPlan.gradeOverride}
            onChange={(next) => onUpdatePlan({ gradeOverride: next })}
            resolved={resolveGrade(videoGradeConfig, sceneAssetGradeOverride, videoPlan.gradeOverride)}
            previewAssetId={videoPlan.sceneVideoId}
            disabled={isBusy}
          />
          <p className="label">
            Ghi đè lên mức mặc định của chính video (Media Library) chỉ cho story này — hữu ích khi
            video bối cảnh này vốn đã tối hơn bình thường.
          </p>
        </Card>
      ) : null}

      <div className="settings-grid">
        <div className="grid gap-1.5">
          <Label>Intro duration (ms)</Label>
          <Input
            type="number"
            min={3000}
            max={30000}
            step={500}
            value={videoPlan.introDurationMs}
            onChange={(event) => onUpdatePlan({ introDurationMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Lead-in before narration (ms)</Label>
          <Input
            type="number"
            min={0}
            max={10000}
            step={100}
            value={videoPlan.leadInMs}
            onChange={(event) => onUpdatePlan({ leadInMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Tail-out after narration (ms)</Label>
          <Input
            type="number"
            min={0}
            max={30000}
            step={500}
            value={videoPlan.tailOutMs}
            onChange={(event) => onUpdatePlan({ tailOutMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Bg music gain (dB)</Label>
          <Input
            type="number"
            step={1}
            value={videoPlan.bgMusicGainDb}
            onChange={(event) => onUpdatePlan({ bgMusicGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Rain gain (dB)</Label>
          <Input
            type="number"
            step={1}
            value={videoPlan.rainAmbienceGainDb}
            onChange={(event) => onUpdatePlan({ rainAmbienceGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Intro music gain (dB)</Label>
          <Input
            type="number"
            step={1}
            value={videoPlan.introMusicGainDb}
            onChange={(event) => onUpdatePlan({ introMusicGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </div>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={videoPlan.duckingEnabled}
            onCheckedChange={(checked) => onUpdatePlan({ duckingEnabled: checked === true })}
            disabled={isBusy}
          />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Duck music under narration</span>
        </label>
      </div>

      {videoPlan.gainManuallyEdited ? (
        <div className="button-row">
          <Badge variant="warn">Gain đã tùy chỉnh cho story này — sẽ không tự đồng bộ khi approve final audio</Badge>
          <Button variant="secondary" size="sm" type="button" onClick={onResetGain} disabled={isBusy}>
            Đồng bộ lại từ library
          </Button>
        </div>
      ) : null}

      <div className="button-row">
        <Button variant="secondary" type="button" onClick={onSavePlan} disabled={isBusy || !isDirty}>
          <Save size={16} aria-hidden="true" />
          Save plan
        </Button>
        <Button variant="secondary" type="button" onClick={onStartRender} disabled={!canRenderVideo}>
          <Clapperboard size={16} aria-hidden="true" />
          Render video
        </Button>
        <Button type="button" onClick={onApproveFinalVideo} disabled={!finalVideoExists}>
          <Check size={16} aria-hidden="true" />
          Approve final video
        </Button>
      </div>

      <Card>
        <CardTitle>Final Video</CardTitle>
        {finalVideoExists ? (
          <>
            <video controls width={480} src={assetUrl(slug, finalVideoPath)} />
            <div className="button-row">
              <Button asChild variant="secondary">
                <a href={assetUrl(slug, finalVideoPath)} download={`${slug}-final.mp4`}>
                  <Download size={16} aria-hidden="true" />
                  Download final MP4
                </a>
              </Button>
              <Button variant="secondary" type="button" onClick={onRevealFinalVideo}>
                <FolderOpen size={16} aria-hidden="true" />
                Reveal in Finder
              </Button>
            </div>
          </>
        ) : (
          <p>Final video will appear after rendering.</p>
        )}
      </Card>

      <Card>
        <CardTitle>
          <History size={16} aria-hidden="true" /> Render History ({videoRenders.length})
        </CardTitle>
        <p className="label">
          Mỗi lần bấm &quot;Render video&quot; tạo ra một file riêng, không đè lên bản trước — dùng
          &quot;Dùng bản này&quot; để so sánh hoặc quay lại một cấu hình đã render trước đó.
        </p>
        {videoRenders.length === 0 ? (
          <p className="label">Chưa có bản render nào.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Thời gian</TableHead>
                <TableHead>Job</TableHead>
                <TableHead>Cấu hình</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {videoRenders.map((render) => (
                <TableRow key={render.jobId}>
                  <TableCell>{new Date(render.renderedAt).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{render.jobId}</TableCell>
                  <TableCell className="text-xs uppercase tracking-wide text-muted-foreground">
                    Intro {Math.round(render.plan.introDurationMs / 1000)}s · Lead-in{' '}
                    {render.plan.leadInMs}ms · Tail {render.plan.tailOutMs}ms · BG{' '}
                    {render.plan.bgMusicGainDb}dB · Rain {render.plan.rainAmbienceGainDb}dB · Intro
                    music {render.plan.introMusicGainDb}dB · Duck{' '}
                    {render.plan.duckingEnabled ? 'on' : 'off'} · {formatLongDuration(render.durationMs)}
                  </TableCell>
                  <TableCell>
                    {render.isApproved ? (
                      <Badge variant="good">Approved</Badge>
                    ) : render.isCurrent ? (
                      <Badge variant="warn">Current</Badge>
                    ) : (
                      <Badge>—</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="button-row">
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={isBusy || render.isCurrent}
                        onClick={() => onSelectRender(render.jobId)}
                      >
                        Dùng bản này
                      </Button>
                      <Button
                        variant="destructive"
                        type="button"
                        disabled={isBusy || render.isCurrent}
                        title={render.isCurrent ? 'Không thể xoá bản đang dùng' : 'Xoá bản render này'}
                        onClick={() => onDeleteRender(render.jobId)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </Card>
  );
};

export default VideoTab;
