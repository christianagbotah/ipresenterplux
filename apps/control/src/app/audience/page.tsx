import { Users } from "lucide-react";
import { StudioReadinessPage } from "@/components/navigation/StudioReadinessPage";

export default function AudiencePage() {
  return <StudioReadinessPage title="Audience" eyebrow="Audience delivery readiness" icon={Users} description="Audience delivery is connected to the existing service live experience." detail="The public live page already carries Program video, Scripture, captions and language channels for a live service. The next implementation slice adds the church-side Audience Studio with automatic service links, QR distribution and embedded preview so operators never construct service IDs manually." actionHref="/operator" actionLabel="Open Service Operator" secondaryHref="/streaming" secondaryLabel="Check Streaming" />;
}
