import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { configRoot } from '@/lib/paths';
import type { YoutubeMetadataFieldGroup } from '@/types/story';

export interface YoutubeMetadataFields {
  titles: string[];
  teaser: string;
  tags: string[];
  thumbnailPrompts: string[];
  pinnedComment: string[];
  model: string;
}

export const ALL_YOUTUBE_METADATA_FIELD_GROUPS: YoutubeMetadataFieldGroup[] = [
  'titles',
  'teaser',
  'tags',
  'thumbnailPrompts',
  'pinnedComment',
];

interface YoutubeMetadataAppConfig {
  baseUrl?: string;
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
  // OpenAI-compatible router (see `.env.local` / config/app.json) — not
  // api.openai.com. Any endpoint speaking /chat/completions works.
  baseUrl: 'https://9router-home.bbns.site/v1',
  model: 'ollama/minimax-m3',
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
              `${config.titleMaxChars} ký tự. QUAN TRỌNG NHẤT: tiêu đề phải GIẬT GÂN, gây tò mò, ` +
              'khiến người lướt YouTube phải bấm vào — TUYỆT ĐỐI không được viết kiểu tóm tắt nội dung ' +
              'truyện hay đặt tên truyện chung chung. Hãy viết như một lời cảnh báo, một bộ quy tắc lạ, ' +
              'một mệnh đề dở dang, hoặc một câu kể ở ngôi thứ nhất với chi tiết cụ thể (giờ giấc, địa ' +
              'điểm, con số) khiến người đọc phải hỏi "rồi sao nữa?". Ví dụ đúng tinh thần cần đạt: ' +
              '"Bộ quy tắc khi mắc kẹt ở ký túc xá", "Đừng tin vào những quy tắc tìm thấy trong trạm ' +
              'kiểm lâm", "Tôi thức dậy lúc 1:20 sáng trên một chuyến tàu không có điểm đến". Ví dụ SAI ' +
              '(kiểu tóm tắt, nhạt, không được viết như vậy): "Câu chuyện về ngôi nhà hoang bí ẩn", ' +
              '"Truyện ma: Người phụ nữ áo trắng". Bám vào chi tiết có thật trong truyện chứ không bịa ' +
              'chi tiết mới, và TUYỆT ĐỐI không spoil đoạn kết hay lời giải bí ẩn. Mỗi phương án phải ' +
              'khác nhau rõ rệt về góc câu kéo (hook), không phải 5 biến thể chữ nghĩa của cùng một câu.',
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
    case 'tags':
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
        },
        required: ['tags'],
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
              'mô tả cách nhau bởi dấu phẩy và kết thúc bằng "..., no text, 16:9". Ảnh phải CHÂN THỰC ' +
              'như ảnh chụp thật, nên hãy tả chất liệu, ánh sáng và ống kính theo hướng photorealistic ' +
              '(vd "photorealistic", "shot on 35mm", "natural skin texture", "volumetric light") và ' +
              'tránh mọi từ gợi tranh vẽ/hoạt hình/3D render. Ví dụ: "A terrified solitary man in a dim ' +
              'Seattle apartment at night, three computer monitors glowing blue, an old rusty hard drive ' +
              'on a cluttered desk, heavy rain on the window, a vague tall gray humanoid silhouette ' +
              'hiding behind a bookshelf, cinematic psychological horror, cold blue lighting, ' +
              'atmospheric shadows, photorealistic details, no text, 16:9". Bắt đầu thẳng vào phần mô tả ' +
              'cảnh — KHÔNG tự viết cụm "An ultra realistic image about" ở đầu, app tự động ghép cụm đó ' +
              'vào trước prompt. Cũng TUYỆT ĐỐI không tự viết câu \'With highlight text "..."\' và không ' +
              'nhắc tới tiêu đề trong prompt — app tự động ghép câu đó ở cuối prompt theo đúng tiêu đề ' +
              'mà operator đang chọn.',
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

// The upstream is an OpenAI-compatible router (9router -> ollama/minimax),
// not OpenAI itself, so `response_format: json_schema` (an OpenAI structured-
// outputs extension) may be rejected outright. Ask for it first — when the
// backend does honour it the output is exactly schema-shaped — and fall back
// to plain `json_object` with the schema inlined in the prompt.
function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

// A json_object-mode (or bare-text) model routinely wraps its answer in a
// ```json fence and/or prefixes a sentence — take the outermost {...} block.
function extractJsonObject(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return candidate.trim();
  }
  return candidate.slice(start, end + 1);
}

interface OpenAiChatCompletionChunk {
  choices: Array<{ delta?: { content?: string | null }; message?: { content?: string | null } }>;
}

// Some models behind the router stream Server-Sent Events (`data: {...}`
// lines) even when `stream: false` is requested. Detect that shape and
// reassemble the full content from the delta chunks instead of failing on
// `response.json()`.
async function parseChatCompletionsResponse(
  response: Response,
  model: string,
): Promise<OpenAiChatCompletionResponse> {
  const text = await response.text();
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('data:')) {
    try {
      return JSON.parse(text) as OpenAiChatCompletionResponse;
    } catch {
      throw new Error(`${model} trả về response không phải JSON hợp lệ: ${text.slice(0, 300)}`);
    }
  }

  let content = '';
  for (const line of trimmed.split('\n')) {
    const payload = line.trim().replace(/^data:\s*/, '');
    if (!payload || payload === '[DONE]') continue;
    try {
      const chunk = JSON.parse(payload) as OpenAiChatCompletionChunk;
      const piece = chunk.choices[0]?.delta?.content ?? chunk.choices[0]?.message?.content;
      if (piece) content += piece;
    } catch {
      // Ignore malformed SSE lines (keep-alive comments, partial frames).
    }
  }
  if (!content) {
    throw new Error(`${model} trả về stream rỗng, không ghép được content.`);
  }
  return { choices: [{ message: { content } }] };
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
  const baseUrl = process.env.OPENAI_BASE_URL?.trim() || config.baseUrl;
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

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  async function request(mode: 'json_schema' | 'json_object'): Promise<Response> {
    return fetch(chatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages:
          mode === 'json_schema'
            ? messages
            : [
                ...messages,
                {
                  role: 'system',
                  content:
                    'Trả về DUY NHẤT một object JSON hợp lệ theo đúng JSON schema sau (không markdown, ' +
                    `không giải thích):\n${JSON.stringify(schema)}`,
                },
              ],
        response_format:
          mode === 'json_schema'
            ? { type: 'json_schema', json_schema: { name: 'youtube_metadata', strict: true, schema } }
            : { type: 'json_object' },
        stream: false,
      }),
    });
  }

  async function requestAndParse(
    mode: 'json_schema' | 'json_object',
  ): Promise<{ parsed: Partial<Omit<YoutubeMetadataFields, 'model'>>; content: string } | null> {
    const response = await request(mode);
    if (!response.ok) {
      if (mode === 'json_schema' && response.status >= 400 && response.status < 500) {
        return null;
      }
      const body = await response.text().catch(() => '');
      throw new Error(`Request tới ${baseUrl} thất bại (${response.status}): ${body.slice(0, 500)}`);
    }

    const data = await parseChatCompletionsResponse(response, config.model);
    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error(`${config.model} trả về response rỗng, không có content.`);
    }

    const json = extractJsonObject(content);
    try {
      const parsed = JSON.parse(json) as Partial<Omit<YoutubeMetadataFields, 'model'>>;
      return { parsed, content };
    } catch {
      if (mode === 'json_schema') {
        return null;
      }
      throw new Error(`${config.model} trả về nội dung không phải JSON hợp lệ: ${content.slice(0, 300)}`);
    }
  }

  // Some backends behind the router accept `response_format: json_schema`
  // and reply 200 while silently ignoring the schema (e.g. answering with
  // unrelated keys). A 200 status alone doesn't mean the shape is right, so
  // verify every required field actually came back before trusting it —
  // otherwise fall back to json_object mode, which embeds the schema as
  // plain text in the prompt and has proven reliable for those models.
  const schemaAttempt = await requestAndParse('json_schema');
  const schemaAttemptValid =
    schemaAttempt !== null &&
    schema.required.every(
      (key) => schemaAttempt.parsed[key as keyof Omit<YoutubeMetadataFields, 'model'>] !== undefined,
    );

  const result = schemaAttemptValid ? schemaAttempt : await requestAndParse('json_object');
  if (!result) {
    throw new Error(`${config.model} không trả về JSON hợp lệ ở cả hai chế độ response_format.`);
  }

  return { ...result.parsed, model: config.model };
}
