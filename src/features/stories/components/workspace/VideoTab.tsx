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
import { toast } from 'react-toastify';

import { mediaApi } from '@/features/stories/api/mediaApi';
import { assetUrl } from '@/features/stories/utils/asset';
import { formatLongDuration } from '@/features/stories/utils/format';
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
  <label className="field">
    <span className="label">
      {CATEGORY_LABELS[category]}
      {required ? ' *' : ' (tùy chọn)'}
    </span>
    <select
      className="select"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
      disabled={disabled}
    >
      <option value="">{required ? '— chọn —' : '(không dùng)'}</option>
      {options.map((asset) => (
        <option key={asset.id} value={asset.id}>
          {asset.name}
        </option>
      ))}
    </select>
    {options.length === 0 ? (
      <span className="label">Chưa có gì trong danh mục này — thêm ở Settings.</span>
    ) : null}
  </label>
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
  onUploadIntroImage,
  onDeleteIntroImage,
  onStartRender,
  onApproveFinalVideo,
  onRevealFinalVideo,
  onSelectRender,
  onDeleteRender,
}) => {
  const mediaByCategory = useMediaByCategory();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!videoPlan) {
    return (
      <section className="panel form">
        <p className="label">Loading video plan...</p>
      </section>
    );
  }

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
    <section className="panel form">
      <div className="page-header">
        <div>
          <h2>Video Assembly</h2>
          <p>
            Formula-based final video: intro image + intro music, then looped scene footage
            under the narration with a music and rain bed mixed underneath.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3>Intro Image (per-story upload)</h3>
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
              <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
                <ImageIcon size={16} aria-hidden="true" />
                Replace
              </button>
              <button className="button danger" type="button" onClick={onDeleteIntroImage} disabled={isBusy}>
                <Trash2 size={16} aria-hidden="true" />
                Remove
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="label">
              Required before rendering — this is the only input that has no library to pick from.
            </p>
            <button className="button" type="button" onClick={() => fileInputRef.current?.click()} disabled={isBusy}>
              <ImageIcon size={16} aria-hidden="true" />
              Upload intro image
            </button>
          </>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={handleChooseIntroImage}
        />
      </div>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={onRandomize} disabled={isBusy}>
          <Dice5 size={16} aria-hidden="true" />
          Random hoá lại
        </button>
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

      <div className="settings-grid">
        <label className="field">
          <span className="label">Intro duration (ms)</span>
          <input
            className="input"
            type="number"
            min={3000}
            max={30000}
            step={500}
            value={videoPlan.introDurationMs}
            onChange={(event) => onUpdatePlan({ introDurationMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field">
          <span className="label">Lead-in before narration (ms)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={10000}
            step={100}
            value={videoPlan.leadInMs}
            onChange={(event) => onUpdatePlan({ leadInMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field">
          <span className="label">Tail-out after narration (ms)</span>
          <input
            className="input"
            type="number"
            min={0}
            max={30000}
            step={500}
            value={videoPlan.tailOutMs}
            onChange={(event) => onUpdatePlan({ tailOutMs: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field">
          <span className="label">Bg music gain (dB)</span>
          <input
            className="input"
            type="number"
            step={1}
            value={videoPlan.bgMusicGainDb}
            onChange={(event) => onUpdatePlan({ bgMusicGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field">
          <span className="label">Rain gain (dB)</span>
          <input
            className="input"
            type="number"
            step={1}
            value={videoPlan.rainAmbienceGainDb}
            onChange={(event) => onUpdatePlan({ rainAmbienceGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field">
          <span className="label">Intro music gain (dB)</span>
          <input
            className="input"
            type="number"
            step={1}
            value={videoPlan.introMusicGainDb}
            onChange={(event) => onUpdatePlan({ introMusicGainDb: Number(event.target.value) })}
            disabled={isBusy}
          />
        </label>
        <label className="field row">
          <input
            type="checkbox"
            checked={videoPlan.duckingEnabled}
            onChange={(event) => onUpdatePlan({ duckingEnabled: event.target.checked })}
            disabled={isBusy}
          />
          <span className="label">Duck music under narration</span>
        </label>
      </div>

      <div className="button-row">
        <button className="button secondary" type="button" onClick={onSavePlan} disabled={isBusy || !isDirty}>
          <Save size={16} aria-hidden="true" />
          Save plan
        </button>
        <button className="button secondary" type="button" onClick={onStartRender} disabled={!canRenderVideo}>
          <Clapperboard size={16} aria-hidden="true" />
          Render video
        </button>
        <button className="button" type="button" onClick={onApproveFinalVideo} disabled={!finalVideoExists}>
          <Check size={16} aria-hidden="true" />
          Approve final video
        </button>
      </div>

      <div className="panel">
        <h3>Final Video</h3>
        {finalVideoExists ? (
          <>
            <video controls width={480} src={assetUrl(slug, finalVideoPath)} />
            <div className="button-row">
              <a className="button secondary" href={assetUrl(slug, finalVideoPath)} download={`${slug}-final.mp4`}>
                <Download size={16} aria-hidden="true" />
                Download final MP4
              </a>
              <button className="button secondary" type="button" onClick={onRevealFinalVideo}>
                <FolderOpen size={16} aria-hidden="true" />
                Reveal in Finder
              </button>
            </div>
          </>
        ) : (
          <p>Final video will appear after rendering.</p>
        )}
      </div>

      <div className="panel">
        <h3>
          <History size={16} aria-hidden="true" /> Render History ({videoRenders.length})
        </h3>
        <p className="label">
          Mỗi lần bấm &quot;Render video&quot; tạo ra một file riêng, không đè lên bản trước — dùng
          &quot;Dùng bản này&quot; để so sánh hoặc quay lại một cấu hình đã render trước đó.
        </p>
        {videoRenders.length === 0 ? (
          <p className="label">Chưa có bản render nào.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Job</th>
                  <th>Cấu hình</th>
                  <th>Trạng thái</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {videoRenders.map((render) => (
                  <tr key={render.jobId}>
                    <td>{new Date(render.renderedAt).toLocaleString()}</td>
                    <td className="mono">{render.jobId}</td>
                    <td className="label">
                      Intro {Math.round(render.plan.introDurationMs / 1000)}s · Lead-in{' '}
                      {render.plan.leadInMs}ms · Tail {render.plan.tailOutMs}ms · BG{' '}
                      {render.plan.bgMusicGainDb}dB · Rain {render.plan.rainAmbienceGainDb}dB · Intro
                      music {render.plan.introMusicGainDb}dB · Duck{' '}
                      {render.plan.duckingEnabled ? 'on' : 'off'} · {formatLongDuration(render.durationMs)}
                    </td>
                    <td>
                      {render.isApproved ? (
                        <span className="badge good">Approved</span>
                      ) : render.isCurrent ? (
                        <span className="badge warn">Current</span>
                      ) : (
                        <span className="badge">—</span>
                      )}
                    </td>
                    <td>
                      <div className="button-row">
                        <button
                          className="button secondary"
                          type="button"
                          disabled={isBusy || render.isCurrent}
                          onClick={() => onSelectRender(render.jobId)}
                        >
                          Dùng bản này
                        </button>
                        <button
                          className="button danger"
                          type="button"
                          disabled={isBusy || render.isCurrent}
                          title={render.isCurrent ? 'Không thể xoá bản đang dùng' : 'Xoá bản render này'}
                          onClick={() => onDeleteRender(render.jobId)}
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
        )}
      </div>
    </section>
  );
};

export default VideoTab;
