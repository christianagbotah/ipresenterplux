import { Bot } from "lucide-react";
import { StudioReadinessPage } from "@/components/navigation/StudioReadinessPage";

export default function AIDirectorPage() {
  return <StudioReadinessPage title="AI Director" eyebrow="Advisory automation readiness" icon={Bot} description="AI remains advisory; Program authority stays with the operator." detail="ASR, Scripture detection, translations and worker health already feed the Control Room. The dedicated AI Director control center will consolidate recommendations and approved auto-preview settings without introducing an unreviewed direct-to-Program bot." actionHref="/scripture" actionLabel="Open Scripture Intelligence" secondaryHref="/translations" secondaryLabel="Open Translations" />;
}
