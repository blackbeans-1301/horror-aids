import 'server-only';

import fs from 'node:fs/promises';
import path from 'node:path';

import { OpenRouter } from '@openrouter/sdk';
import type {
  ChatMessages,
  ChatResult,
  ProviderPreferences,
  ResponseFormat,
} from '@openrouter/sdk/models';
import { OpenRouterError } from '@openrouter/sdk/models/errors';

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
  // OpenRouter provider routing (see https://openrouter.ai/docs/provider-routing).
  // `providerOnly` pins the request to specific provider slugs; `allowFallbacks:
  // false` makes the request fail instead of silently routing elsewhere, which
  // keeps cost/latency predictable for a single-operator tool.
  providerOnly?: string[];
  allowFallbacks?: boolean;
  titleVariantCount?: number;
  titleMaxChars?: number;
  thumbnailPromptVariantCount?: number;
  pinnedCommentVariantCount?: number;
  tagsMaxCount?: number;
  tone?: string;
  targetAudience?: string;
}

const DEFAULT_CONFIG: Required<YoutubeMetadataAppConfig> = {
  // OpenRouter's OpenAI-compatible gateway (see `.env.local` / config/app.json).
  // Model ids are `vendor/model` slugs from https://openrouter.ai/models.
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'openai/gpt-6-luna',
  providerOnly: ['openai/flex'],
  allowFallbacks: false,
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
              `${config.titleMaxChars} ký tự. QUAN TRỌNG NHẤT: tiêu đề phải GIẬT GÂN, gây tò mò, khiến ` +
              'người lướt YouTube phải dừng lại bấm vào — nhưng đọc lên phải NGHE TỰ NHIÊN như lời một ' +
              'người thật đang kể lại chuyện của chính họ, TUYỆT ĐỐI không phải văn phong clickbait sáo ' +
              'rỗng kiểu marketing ("bạn sẽ không tin...", "sự thật kinh hoàng đằng sau...", "điều không ' +
              'ai dám kể..."). Cũng TUYỆT ĐỐI không viết kiểu tóm tắt nội dung truyện hay đặt tên chung ' +
              'chung ("Câu chuyện về ngôi nhà hoang bí ẩn", "Truyện ma: Người phụ nữ áo trắng").\n\n' +
              'Mỗi tiêu đề phải bám vào MỘT chi tiết có thật, cụ thể trong truyện (tên riêng, địa điểm, ' +
              'câu thoại, đồ vật, con số, nghề nghiệp, mối quan hệ...) — không bịa thêm chi tiết mới, và ' +
              'TUYỆT ĐỐI không spoil đoạn kết hay lời giải bí ẩn.\n\n' +
              `${config.titleVariantCount} phương án PHẢI dùng ${config.titleVariantCount} KIỂU HOOK khác ` +
              'nhau rõ rệt, không phải 5 biến thể chữ nghĩa của cùng một câu. Chọn trong các kiểu sau (hoặc ' +
              'tương đương), mỗi kiểu dùng tối đa 1 lần — và đừng mặc định lạm dụng kiểu "bộ quy tắc" hay ' +
              '"tôi thức dậy lúc [giờ]", đó chỉ là 2 trong rất nhiều lựa chọn bên dưới, không phải công ' +
              'thức mặc định:\n' +
              '1. Lời cảnh báo/dặn dò trực tiếp gửi người xem ("Đừng bao giờ...", "Nếu bạn từng...").\n' +
              '2. Một câu thoại/lời trích rợn người lấy nguyên văn từ truyện, để trong ngoặc kép.\n' +
              '3. Một sự thật vô lý, nghịch lý khiến người đọc phải hỏi "sao lại thế được" ("Ngôi nhà đó ' +
              'không có tầng 4", "Điện thoại vẫn đổ chuông dù tôi đã cắt SIM 3 năm trước").\n' +
              '4. Câu kể ngôi thứ nhất gắn với một thời điểm/địa điểm cụ thể trong truyện.\n' +
              '5. Một nghề nghiệp hoặc hoàn cảnh khác thường, kèm hệ quả bí ẩn đi cùng nó.\n' +
              '6. Một câu hỏi ngỏ, chưa có lời giải, khiến người xem phải bấm vào mới biết.\n' +
              '7. Một lời thú nhận hoặc tiết lộ nửa chừng, như đang kể dở cho bạn bè nghe.\n' +
              '8. Bộ quy tắc/luật lệ kỳ lạ cần tuân theo — chỉ dùng khi thực sự khớp mạch truyện.\n\n' +
              'Viết bằng ngôn ngữ đời thường, tránh mọi tính từ kêu sáo rỗng ("kinh hoàng", "rùng rợn", ' +
              '"ám ảnh" dùng lặp đi lặp lại) — để chi tiết cụ thể tự nó tạo cảm giác rợn người, không cần ' +
              'tính từ hô hào.',
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

// The teaser's schema description tells the model to separate paragraphs
// with "\n\n" — meant as a real-newline instruction, but some models (seen
// with ollama/gpt-oss:120b) echo that notation back literally as the two
// characters `\` + `n` instead of emitting an actual line break. JSON.parse
// already turns a *properly* JSON-escaped "\n" into a real newline, so this
// only fires when the model wrote the literal backslash-n itself.
function normalizeEscapedNewlines(text: string): string {
  return text.replace(/\\r\\n|\\n/g, '\n');
}

// Structured-output responses are plain strings, but a few providers return
// the assistant message as an array of content parts — join the text parts.
function messageContentToString(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('');
  }
  return '';
}

// A long narration plus the system prompt/schema can far exceed a default HTTP
// timeout; give the model plenty of room before aborting.
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

// Shown in OpenRouter's dashboard/rankings alongside this app's usage.
const APP_TITLE = 'horror-aids';

export async function generateYoutubeMetadataFields(input: {
  title: string;
  storyText: string;
  videoDurationMs: number | null;
  fieldGroups: YoutubeMetadataFieldGroup[];
}): Promise<Partial<YoutubeMetadataFields> & { model: string }> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY chưa được cấu hình — thêm vào .env.local trước khi generate metadata.',
    );
  }

  const config = await readYoutubeMetadataConfig();
  const baseUrl = process.env.OPENROUTER_BASE_URL?.trim() || config.baseUrl;
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

  const messages: ChatMessages[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Pin routing when the config asks for it; leaving `only` unset lets
  // OpenRouter load-balance across every endpoint serving the model.
  const provider: ProviderPreferences = {
    allowFallbacks: config.allowFallbacks,
    ...(config.providerOnly.length > 0 ? { only: config.providerOnly } : {}),
  };

  const client = new OpenRouter({
    apiKey,
    serverURL: baseUrl,
    appTitle: APP_TITLE,
    httpReferer: process.env.OPENROUTER_HTTP_REFERER?.trim() || undefined,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  async function request(mode: 'json_schema' | 'json_object'): Promise<ChatResult> {
    const responseFormat: ResponseFormat =
      mode === 'json_schema'
        ? { type: 'json_schema', jsonSchema: { name: 'youtube_metadata', strict: true, schema } }
        : { type: 'json_object' };

    const response = await client.chat.send({
      chatRequest: {
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
        responseFormat,
        provider,
        stream: false,
      },
    });

    if (!('choices' in response)) {
      throw new Error(`${config.model} trả về stream thay vì JSON hoàn chỉnh.`);
    }
    return response;
  }

  async function requestAndParse(
    mode: 'json_schema' | 'json_object',
  ): Promise<{ parsed: Partial<Omit<YoutubeMetadataFields, 'model'>>; content: string } | null> {
    let response: ChatResult;
    try {
      response = await request(mode);
    } catch (error) {
      if (mode === 'json_schema' && error instanceof OpenRouterError) {
        // A model/provider that rejects structured outputs fails the whole
        // request with a 4xx — the caller retries in json_object mode.
        if (error.statusCode >= 400 && error.statusCode < 500) {
          return null;
        }
        throw new Error(
          `Request tới ${baseUrl} thất bại (${error.statusCode}): ${error.body.slice(0, 500)}`,
        );
      }
      throw error;
    }

    const content = messageContentToString(response.choices[0]?.message.content);
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

  // Some providers accept `response_format: json_schema` and reply 200 while
  // silently ignoring the schema (e.g. answering with unrelated keys). A 200
  // status alone doesn't mean the shape is right, so verify every required
  // field actually came back before trusting it — otherwise fall back to
  // json_object mode, which embeds the schema as plain text in the prompt.
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

  const parsed = result.parsed;
  if (typeof parsed.teaser === 'string') {
    parsed.teaser = normalizeEscapedNewlines(parsed.teaser);
  }

  return { ...parsed, model: config.model };
}
