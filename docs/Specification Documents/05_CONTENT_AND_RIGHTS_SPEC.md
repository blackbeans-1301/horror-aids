# Content And Rights Specification

> **Implementation status:** this document is mostly aspirational. `rightsStatus`/`sourceType`/`sourceUrl` exist on `story.json` and are PATCH-able via the API, but no screen currently displays or edits them, and `metadata/permissions.md`/`metadata/source.md` are never created or read anywhere in the code — only `metadata/notes.md` is created at story creation. Treat the policies below as intent to design toward, not delivered behavior.

## Position

Horror Aids MVP helps one creator produce Vietnamese horror narration audio from stories they write.

It should prioritize original/manual stories and controlled audio production.

## Source Types

### `manual`

User-written or manually pasted story.

Default MVP path.

Requirements:

- User confirms they have rights.
- Store source notes if needed.
- Human review required before TTS.

### `generated_later`

Generated story from prompt/idea.

Later phase, not required for MVP.

Requirements when added:

- Store prompt.
- Store generation settings.
- Human review required.

### `reddit_reference_later`

Reddit post used for trend/theme/reference only.

Later phase, not required for MVP.

Requirements when added:

- Store URL/title.
- Do not copy full story into production by default.
- Use for inspiration, trope, pacing, topic.

### `reddit_import_later`

Reddit text imported into local workspace.

High risk and later phase only.

Requirements when added:

- Store source URL.
- Store author.
- Store permission status.
- If no permission, require `risk_acknowledged`.
- UI must label it clearly.

## Rights Status

- `original`: user wrote the story or owns it.
- `permission_recorded`: creator has permission.
- `reference_only`: used only for inspiration.
- `risk_acknowledged`: user accepted risk.

## Required Files

For non-original sources:

```text
metadata/permissions.md
metadata/source.md
```

`permissions.md` should include:

- Source URL.
- Author.
- Permission status.
- Contact notes.
- Date recorded.

## Human Review Requirements

Before TTS:

- Story text reviewed for quality.
- Source risk reviewed if story is not original.
- Characters and speaker segments reviewed.
- Vietnamese output text sounds natural.

Before final audio approval:

- Final WAV reviewed.
- No obvious missing or duplicated lines.
- Character voice assignments are acceptable.
- Source status is recorded.

## Reddit Use Policy For MVP

MVP does not need Reddit scraping/import.

Recommended later approach:

1. Use Reddit only for themes and popular hooks.
2. Write original Vietnamese story inspired by pattern.
3. Do not translate full Reddit story unless permission exists.

Not allowed by product default:

- Auto scrape and auto publish.
- Hide source.
- Pretend imported story is original.

## Audio Package Notes

`metadata/notes.md` can include:

- Story source notes.
- Character/voice notes.
- TTS issue notes.
- Final review notes.

## Channel Strategy

Quality-first for channel from zero:

- Build consistent Vietnamese narrator persona.
- Use character voices intentionally.
- Keep original recurring style.
- Avoid obvious reused-content workflow.
- Keep source and adaptation notes.

## Risk Notes

- Translation does not remove copyright risk.
- AI voice quality directly affects audience trust.
- Reused content can affect monetization later even without strikes.
- Permission workflow protects long-term channel health.
