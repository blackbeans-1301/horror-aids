import { StoryWorkspaceClient } from '@/features/stories/components/StoryWorkspaceClient';

interface StoryPageProps {
  params: Promise<{ slug: string }>;
}

export default async function StoryPage({
  params,
}: StoryPageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  return <StoryWorkspaceClient slug={slug} />;
}
