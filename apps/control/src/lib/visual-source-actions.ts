export type VisualSourceAction = "rescan" | "preview" | "clear_preview";

type VisualActionInput = {
  edgeDeviceId: string;
  serviceId: string | null;
  action: VisualSourceAction;
  sourceId?: string;
};

type EdgeCommandResponse = {
  ok?: boolean;
  commandId?: string;
  error?: string;
};

const COMMAND_BY_ACTION: Record<VisualSourceAction, "visual.rescan" | "visual.preview.select" | "visual.preview.clear"> = {
  rescan: "visual.rescan",
  preview: "visual.preview.select",
  clear_preview: "visual.preview.clear"
};

export async function requestVisualAction(input: VisualActionInput): Promise<{ commandId?: string; message: string }> {
  const edgeDeviceId = input.edgeDeviceId.trim();
  if (!edgeDeviceId) throw new Error("An Edge device is required");

  const sourceId = input.sourceId?.trim();
  if (input.action === "preview" && !sourceId) throw new Error("A visual source is required for Preview");

  const response = await fetch(`/api/v1/edge/devices/${encodeURIComponent(edgeDeviceId)}/commands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      serviceId: input.serviceId,
      type: COMMAND_BY_ACTION[input.action],
      arguments: input.action === "preview" ? { sourceId } : {}
    })
  });
  const payload = await response.json().catch(() => null) as EdgeCommandResponse | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "Could not request the visual source action");
  }

  const message = input.action === "preview"
    ? "Preview requested · waiting for Edge confirmation"
    : input.action === "clear_preview"
      ? "Clear Preview requested · waiting for Edge confirmation"
      : "Rescan sources requested";
  return { commandId: payload.commandId, message };
}
