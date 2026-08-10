import { ContentStoryDetailClient } from '@/features/library/components/ContentStoryDetailClient';

interface ContentStoryPageProps {
  params: Promise<{ id: string }>;
}

export default async function ContentStoryPage({
  params,
}: ContentStoryPageProps): Promise<React.ReactElement> {
  const { id } = await params;
  return <ContentStoryDetailClient id={id} />;
}
