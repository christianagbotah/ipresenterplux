import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateEdgeDevice } from "@/lib/edge-auth";
import {
  EdgePresentationResolverError,
  presentationThemeContentVariant,
  resolveEdgePresentationItem,
  type EdgePresentationQueryClient,
} from "@/lib/edge-presentation-resolver";
import { resolveServicePresentationTheme, resolveThemeAppearance, resolveThemeAssetManifest } from "@/lib/presentation-themes";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const device = await authenticateEdgeDevice(request);
  if (!device) return NextResponse.json({ ok: false, error: "Device authentication required" }, { status: 401 });

  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ ok: false, error: "Invalid presentation item id" }, { status: 400 });
  }

  try {
    const item = await resolveEdgePresentationItem(db as unknown as EdgePresentationQueryClient, {
      deviceId: device.deviceId,
      organizationId: device.organizationId,
      itemId: id,
    });
    if (!item) {
      return NextResponse.json({ ok: false, error: "Presentation item not available for this device" }, { status: 404 });
    }

    const serviceTheme = await resolveServicePresentationTheme(db, device.organizationId, item.serviceId);
    const projectorTheme = resolveThemeAppearance(serviceTheme.appearance, {
      contentType: presentationThemeContentVariant(item.itemType),
      output: "projector",
    });
    const themeAssets = await resolveThemeAssetManifest(db, device.organizationId, projectorTheme);

    return NextResponse.json({
      ok: true,
      item: {
        ...item,
        metadata: {
          ...item.metadata,
          themeAppearanceV1: JSON.stringify(projectorTheme),
          themeAssetsV1: JSON.stringify(themeAssets),
        },
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof EdgePresentationResolverError) {
      return NextResponse.json({ ok: false, error: error.code }, { status: 422 });
    }
    throw error;
  }
}
