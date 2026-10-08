import { Video } from "lucide-react";
import { StudioReadinessPage } from "@/components/navigation/StudioReadinessPage";

export default function ArchivePage() {
  return <StudioReadinessPage title="Archive" eyebrow="Completed service readiness" icon={Video} description="Completed service records remain intact while the archive browser is connected." detail="The dedicated Archive workspace will expose ended-service rundown, Scripture and retained transcript/recording metadata in the next implementation slice. This readiness screen deliberately does not invent recording files or storage links that the Edge runtime has not reported." actionHref="/planner" actionLabel="Open Service Planner" secondaryHref="/" secondaryLabel="Return to Control Room" />;
}
