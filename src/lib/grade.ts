import type { GradeOverride } from '@/types/story';

export interface ConfigGrade {
  brightness: number;
  saturation: number;
  vignette: boolean;
}

export interface ResolvedGrade {
  brightness: number;
  saturation: number;
  vignette: boolean;
}

// Precedence: story override > asset override > global config default.
// Mirrors resolve_grade in workers/common.py — keep the two in sync.
export function resolveGrade(
  configGrade: ConfigGrade,
  assetOverride: GradeOverride | null | undefined,
  storyOverride: GradeOverride | null | undefined,
): ResolvedGrade {
  const brightness = storyOverride?.brightness ?? assetOverride?.brightness ?? configGrade.brightness;
  const vignette = storyOverride?.vignette ?? assetOverride?.vignette ?? configGrade.vignette;
  return { brightness, saturation: configGrade.saturation, vignette };
}

// Approximate CSS mapping for the instant live preview only — ffmpeg's `eq`
// brightness is additive (0 = no change), CSS brightness() is multiplicative
// (100% = no change); saturation/saturate() are both multipliers already.
export function gradeToCssFilter(grade: ResolvedGrade): string {
  const brightnessPct = Math.max(0, (1 + grade.brightness) * 100);
  const saturatePct = Math.max(0, grade.saturation * 100);
  return `brightness(${brightnessPct.toFixed(0)}%) saturate(${saturatePct.toFixed(0)}%)`;
}
