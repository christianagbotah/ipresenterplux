import { Music2 } from "lucide-react";
import { StudioReadinessPage } from "@/components/navigation/StudioReadinessPage";

export default function MediaPage() {
  return <StudioReadinessPage title="Songs & Media" eyebrow="Service content readiness" icon={Music2} description="Prepare media through the existing service workflow today." detail="The dedicated reusable media library is the next implementation slice. Until it lands, service songs, slides and media cues remain managed through the Service Planner and Operator pipeline rather than a fake or disconnected browser upload flow." actionHref="/planner" actionLabel="Open Service Planner" secondaryHref="/operator" secondaryLabel="Open Operator" />;
}
