import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { configRoot } from '@/lib/paths';
import type { YoutubeMetadataFieldGroup } from '@/types/story';

export interface YoutubeMetadataFields {
  titles: string[];
  teaser: string;
  tags: string[];
  category: string;
  thumbnailPrompts: string[];
  pinnedComment: string[];
  model: string;
}

export const ALL_YOUTUBE_METADATA_FIELD_GROUPS: YoutubeMetadataFieldGroup[] = [
  'titles',
  'teaser',
  'tagsAndCategory',
  'thumbnailPrompts',
  'pinnedComment',
];

interface YoutubeMetadataAppConfig {
  model?: string;
  titleVariantCount?: number;
  titleMaxChars?: number;
  thumbnailPromptVariantCount?: number;
  pinnedCommentVariantCount?: number;
  tagsMaxCount?: number;
  tone?: string;
  targetAudience?: string;
}

const DEFAULT_CONFIG: Required<YoutubeMetadataAppConfig> = {
  model: 'gpt-4.1',
  titleVariantCount: 5,
  titleMaxChars: 100,
  thumbnailPromptVariantCount: 2,
  pinnedCommentVariantCount: 3,
  tagsMaxCount: 8,
  tone:
    'kể chuyện ma Việt Nam, giọng radio đêm khuya, rùng rợn nhưng không giật gân rẻ tiền, ' +
    'không spoil đoạn kết hay lời giải bí ẩn của truyện',
  targetAudience: 'người Việt 18-35 tuổi thích nghe truyện ma khi ngủ, lái xe, hoặc làm việc',
};

// Deliberately reads config/app.json with plain fs rather than importing
// readJsonFile from json-store.ts — json-store.ts calls into this module, so
// importing back would create a circular module dependency.
async function readYoutubeMetadataConfig(): Promise<Required<YoutubeMetadataAppConfig>> {
  try {
    const raw = await fs.readFile(path.join(configRoot, 'app.json'), 'utf8');
    const parsed = JSON.parse(raw) as { youtubeMetadata?: YoutubeMetadataAppConfig };
    return { ...DEFAULT_CONFIG, ...parsed.youtubeMetadata };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// YouTube Studio's fixed category list (a video may only have one).
const YOUTUBE_CATEGORIES = [
  'Film & Animation',
  'Autos & Vehicles',
  'Music',
  'Pets & Animals',
  'Sports',
  'Travel & Events',
  'Gaming',
  'People & Blogs',
  'Comedy',
  'Entertainment',
  'News & Politics',
  'Howto & Style',
  'Education',
  'Science & Technology',
  'Nonprofits & Activism',
] as const;

// A full ~20-30 minute narration plus the system prompt/schema can run well
// past a comfortable request size. Trim from the middle, not the tail, so the
// model still sees both the opening hook and how the story is shaped overall
// (without ever putting the literal ending text right next to the "don't
// spoil the ending" instruction, which risks it echoing that text verbatim).
const MAX_STORY_TEXT_CHARS = 24000;

function truncateStoryText(storyText: string): string {
  if (storyText.length <= MAX_STORY_TEXT_CHARS) {
    return storyText;
  }
  const headLength = Math.floor(MAX_STORY_TEXT_CHARS * 0.7);
  const tailLength = MAX_STORY_TEXT_CHARS - headLength;
  const head = storyText.slice(0, headLength);
  const tail = storyText.slice(-tailLength);
  return `${head}\n\n[... đoạn giữa truyện được lược bớt để vừa giới hạn ...]\n\n${tail}`;
}

interface OpenAiChatCompletionResponse {
  choices: Array<{ message: { content: string | null } }>;
}

interface SchemaProperty {
  [key: string]: unknown;
}

function buildFieldGroupSchema(
  group: YoutubeMetadataFieldGroup,
  config: Required<YoutubeMetadataAppConfig>,
): { properties: Record<string, SchemaProperty>; required: string[] } {
  switch (group) {
    case 'titles':
      return {
        properties: {
          titles: {
            type: 'array',
            items: { type: 'string' },
            minItems: config.titleVariantCount,
            maxItems: config.titleVariantCount,
            description:
              `${config.titleVariantCount} phương án tiêu đề tiếng Việt khác nhau, mỗi tiêu đề tối đa ` +
              `${config.titleMaxChars} ký tự. Tự chọn phần mở đầu/prefix phù hợp với nội dung truyện ` +
              '(vd "Truyện ma đêm khuya", "Truyện ma xứ người", "Truyện kinh dị có thật"...) — không ép theo 1 khuôn cố định.',
          },
        },
        required: ['titles'],
      };
    case 'teaser':
      return {
        properties: {
          teaser: {
            type: 'string',
            description:
              'Đoạn giới thiệu truyện bằng tiếng Việt, gồm nhiều câu/đoạn ngắn cách nhau bởi hai dấu xuống ' +
              'dòng liên tiếp (\\n\\n), tạo không khí rùng rợn và tò mò. TUYỆT ĐỐI không được tiết lộ đoạn ' +
              'kết hoặc lời giải của bí ẩn trong truyện.',
          },
        },
        required: ['teaser'],
      };
    case 'tagsAndCategory':
      return {
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            maxItems: config.tagsMaxCount,
            description:
              'Từ khoá cho ô Tags của YouTube Studio, gồm 2 nhóm: (1) luôn có vài tag chứa từ "nosleep" ' +
              '(vd "nosleep", "nosleep stories", "r/nosleep") và vài tag chứa từ "creepypasta" (vd ' +
              '"creepypasta", "creepypasta stories") — hai từ khoá tiếng Anh này được search rất nhiều cho ' +
              'thể loại truyện kinh dị nên giúp video được index tốt hơn dù kênh nói tiếng Việt; (2) chỉ ' +
              '1-2 tag bám sát nội dung cụ thể của truyện (bối cảnh, chủ đề, con vật/hiện tượng siêu nhiên ' +
              'xuất hiện...), không thêm nhiều tag chung chung khác.',
          },
          category: { type: 'string', enum: [...YOUTUBE_CATEGORIES] },
        },
        required: ['tags', 'category'],
      };
    case 'thumbnailPrompts':
      return {
        properties: {
          thumbnailPrompts: {
            type: 'array',
            items: { type: 'string' },
            minItems: config.thumbnailPromptVariantCount,
            maxItems: config.thumbnailPromptVariantCount,
            description:
              'Prompt bằng tiếng Anh để dán trực tiếp vào một AI image generator (Midjourney/DALL-E/etc.), ' +
              'mô tả cảnh, ánh sáng, tâm trạng horror khớp với câu chuyện, viết thành một chuỗi các cụm ' +
              'mô tả cách nhau bởi dấu phẩy và kết thúc bằng "..., no text, 16:9". Ví dụ: "A terrified ' +
              'solitary man in a dim Seattle apartment at night, three computer monitors glowing blue, an ' +
              'old rusty hard drive on a cluttered desk, heavy rain on the window, a vague tall gray ' +
              'humanoid silhouette hiding behind a bookshelf, cinematic psychological horror, cold blue ' +
              'lighting, atmospheric shadows, realistic details, no text, 16:9". TUYỆT ĐỐI không tự viết ' +
              'câu \'With highlight text "..."\' và không nhắc tới tiêu đề trong prompt — app tự động ghép ' +
              'câu đó ở cuối prompt theo đúng tiêu đề mà operator đang chọn.',
          },
        },
        required: ['thumbnailPrompts'],
      };
    case 'pinnedComment':
      return {
        properties: {
          pinnedComment: {
            type: 'array',
            items: { type: 'string' },
            minItems: config.pinnedCommentVariantCount,
            maxItems: config.pinnedCommentVariantCount,
            description:
              `${config.pinnedCommentVariantCount} phương án bình luận ghim bằng tiếng Việt — câu hỏi hoặc lời ` +
              'gợi mở thảo luận liên quan tới nội dung truyện, giữ giọng văn của kênh, mỗi phương án khác nhau, ' +
              'không theo khuôn cố định nào.',
          },
        },
        required: ['pinnedComment'],
      };
  }
}

export async function generateYoutubeMetadataFields(input: {
  title: string;
  storyText: string;
  videoDurationMs: number | null;
  fieldGroups: YoutubeMetadataFieldGroup[];
}): Promise<Partial<YoutubeMetadataFields> & { model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY chưa được cấu hình — thêm vào .env.local trước khi generate metadata.');
  }

  const config = await readYoutubeMetadataConfig();
  const durationNote = input.videoDurationMs
    ? `Video dài khoảng ${Math.round(input.videoDurationMs / 60000)} phút.`
    : '';

  const groups = input.fieldGroups.length > 0 ? input.fieldGroups : ALL_YOUTUBE_METADATA_FIELD_GROUPS;
  const built = groups.map((group) => buildFieldGroupSchema(group, config));

  const schema = {
    type: 'object',
    properties: Object.assign({}, ...built.map((b) => b.properties)) as Record<string, SchemaProperty>,
    required: built.flatMap((b) => b.required),
    additionalProperties: false,
  };

  const systemPrompt =
    'Bạn là biên tập viên metadata YouTube cho kênh truyện ma tiếng Việt "666Hz Radio". ' +
    `Giọng văn: ${config.tone}. Đối tượng khán giả: ${config.targetAudience}. ` +
    'Chỉ trả lời đúng theo JSON schema được cung cấp, không thêm giải thích ngoài JSON.';

  const userPrompt = `Tên truyện: ${input.title}\n${durationNote}\n\nNội dung truyện:\n${truncateStoryText(input.storyText)}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'youtube_metadata', strict: true, schema },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI request thất bại (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as OpenAiChatCompletionResponse;
  const content = data.choices[0]?.message.content;
  if (!content) {
    throw new Error('OpenAI trả về response rỗng, không có content.');
  }

  const parsed = JSON.parse(content) as Partial<Omit<YoutubeMetadataFields, 'model'>>;
  return { ...parsed, model: config.model };
}
