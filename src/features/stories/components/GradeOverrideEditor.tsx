'use client';

import { Play } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { NumberInput } from '@/components/ui/number-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { mediaApi } from '@/features/stories/api/mediaApi';
import { gradeToCssFilter, type ResolvedGrade } from '@/lib/grade';
import type { GradeOverride } from '@/types/story';

type VignetteChoice = 'inherit' | 'on' | 'off';

function vignetteChoiceFromValue(value: boolean | null): VignetteChoice {
  if (value === null) return 'inherit';
  return value ? 'on' : 'off';
}

function vignetteValueFromChoice(choice: VignetteChoice): boolean | null {
  if (choice === 'inherit') return null;
  return choice === 'on';
}

interface GradeOverrideEditorProps {
  title: string;
  value: GradeOverride;
  onChange: (next: GradeOverride) => void;
  resolved: ResolvedGrade;
  previewAssetId: string | null;
  disabled: boolean;
}

export const GradeOverrideEditor: React.FC<GradeOverrideEditorProps> = ({
  title,
  value,
  onChange,
  resolved,
  previewAssetId,
  disabled,
}) => {
  const [isRenderingPreview, setIsRenderingPreview] = useState(false);
  const [previewClipUrl, setPreviewClipUrl] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  const renderPreview = async (): Promise<void> => {
    if (!previewAssetId) {
      toast.error('Chọn video bối cảnh trước khi render preview.');
      return;
    }
    setIsRenderingPreview(true);
    try {
      const blob = await mediaApi.previewGrade(previewAssetId, {
        brightness: resolved.brightness,
        vignette: resolved.vignette,
      });
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
      const url = URL.createObjectURL(blob);
      objectUrlRef.current = url;
      setPreviewClipUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Render preview thất bại');
    } finally {
      setIsRenderingPreview(false);
    }
  };

  return (
    <div className="grid gap-3">
      <h3>{title}</h3>
      <div className="settings-grid">
        <Label className="flex items-center gap-2">
          <Checkbox
            checked={value.brightness !== null}
            onCheckedChange={(checked) => onChange({ ...value, brightness: checked === true ? 0 : null })}
            disabled={disabled}
          />
          Override brightness
        </Label>
        <div className="grid gap-1.5">
          <Label>Brightness (-1 đến 1, mặc định global -0.05)</Label>
          <NumberInput
            step={0.01}
            min={-1}
            max={1}
            value={value.brightness ?? 0}
            onChange={(next) => onChange({ ...value, brightness: next })}
            disabled={disabled || value.brightness === null}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Vignette</Label>
          <Select
            value={vignetteChoiceFromValue(value.vignette)}
            onValueChange={(choice) => onChange({ ...value, vignette: vignetteValueFromChoice(choice as VignetteChoice) })}
            disabled={disabled}
          >
            <SelectTrigger disabled={disabled}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit">Dùng mặc định global</SelectItem>
              <SelectItem value="on">Bật</SelectItem>
              <SelectItem value="off">Tắt</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {previewAssetId ? (
        <div className="grid gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Preview tức thời (CSS filter, gần đúng)
          </span>
          <div style={{ position: 'relative', width: 320 }}>
            <video
              controls
              width={320}
              src={mediaApi.assetUrl(previewAssetId)}
              style={{ filter: gradeToCssFilter(resolved), display: 'block' }}
            />
            {resolved.vignette ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)',
                }}
              />
            ) : null}
          </div>
          <div className="button-row">
            <Button type="button" variant="secondary" onClick={() => void renderPreview()} disabled={isRenderingPreview}>
              <Play size={14} aria-hidden="true" />
              {isRenderingPreview ? 'Đang render...' : 'Render preview chính xác (ffmpeg)'}
            </Button>
          </div>
          {previewClipUrl ? (
            <div className="grid gap-1.5">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Preview chính xác (đúng filter chain sẽ dùng khi render thật)
              </span>
              <video controls width={320} src={previewClipUrl} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default GradeOverrideEditor;
