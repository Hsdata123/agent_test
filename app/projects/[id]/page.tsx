import { DashboardProvider } from "@/components/Dashboard";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DashboardProvider view="project" projectId={id} />;
}
