export async function readStoryFilesAsText(files: FileList | File[]): Promise<string> {
  const list = Array.from(files);
  const contents = await Promise.all(list.map((file) => file.text()));
  return contents.map((content) => content.trim()).join('\n\n');
}
