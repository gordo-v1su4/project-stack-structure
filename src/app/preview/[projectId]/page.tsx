import { AnimaticPreviewPage } from "@/components/studio/AnimaticPreviewPage";

export default async function PreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <AnimaticPreviewPage key={projectId} projectId={projectId} />;
}
