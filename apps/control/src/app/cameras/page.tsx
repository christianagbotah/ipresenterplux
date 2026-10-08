import { Camera } from "lucide-react";
import { StudioReadinessPage } from "@/components/navigation/StudioReadinessPage";

export default function CamerasPage() {
  return <StudioReadinessPage title="Cameras" eyebrow="Edge capture readiness" icon={Camera} description="Camera capture is owned by the church Edge computer." detail="The VPS browser does not pretend to capture sanctuary cameras directly. Pair and verify the production computer first; the dedicated Cameras workspace will surface Edge-reported sources, permissions and routing truth in the next implementation slice." actionHref="/settings/devices" actionLabel="Manage Edge Devices" secondaryHref="/" secondaryLabel="View Control Room telemetry" />;
}
