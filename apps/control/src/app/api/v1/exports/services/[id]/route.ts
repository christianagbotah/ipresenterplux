import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { loadPlannerServiceDetail } from "@/lib/planner-service-queries";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeHttps(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function portableItem(item: { itemType: string; title: string; content: unknown }) {
  const content = object(item.content);
  if (item.itemType === "song") {
    const sections = Array.isArray(content.sections)
      ? content.sections.map((raw) => {
          const section = object(raw);
          return { label: String(section.label ?? "Section"), text: String(section.text ?? "") };
        })
      : [];
    return { itemType: "song", title: item.title, input: { title: item.title, author: typeof content.author === "string" ? content.author : undefined, sections } };
  }
  if (item.itemType === "slide") {
    return { itemType: "slide", title: item.title, input: { title: item.title, body: String(content.body ?? ""), footer: typeof content.footer === "string" ? content.footer : undefined, style: typeof content.style === "string" ? content.style : "default" } };
  }
  if (item.itemType === "scripture") {
    return { itemType: "scripture", title: item.title, input: { reference: String(content.reference ?? item.title), version: typeof content.version === "string" ? content.version : undefined, footer: typeof content.footer === "string" ? content.footer : undefined } };
  }
  if (item.itemType === "media") {
    const assetUrl = safeHttps(content.assetUrl);
    if (!assetUrl) return null;
    return { itemType: "media", title: item.title, input: { title: item.title, assetUrl, mediaKind: typeof content.mediaKind === "string" ? content.mediaKind : "video" } };
  }
  return null;
}

function csvCell(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return `"${text.replaceAll('"', '""')}"`;
}

function download(body: string, contentType: string, filename: string) {
  return new Response(body, { headers: { "Content-Type": contentType, "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "Invalid service id" }, { status: 400 });
  const format = (new URL(request.url).searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv") return NextResponse.json({ ok: false, error: "Export format must be json or csv" }, { status: 400 });

  const client = await db.connect();
  try {
    const detail = await loadPlannerServiceDetail(client, session.user.id, id);
    const items = detail.items.map(portableItem).filter((item): item is NonNullable<typeof item> => Boolean(item));
    const omitted = detail.items.filter((item) => !portableItem(item)).map((item) => ({ title: item.title, itemType: item.itemType, reason: "No portable representation is available for this cue" }));
    if (format === "csv") {
      const rows = [["itemType", "title", "input"], ...items.map((item) => [item.itemType, item.title, JSON.stringify(item.input)])];
      return download(rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv; charset=utf-8", "ipresenterplux-service.csv");
    }
    return download(JSON.stringify({ version: 1, type: "ipresenterplux-service-rundown", exportedAt: new Date().toISOString(), title: detail.service.title, serviceType: detail.service.serviceType, scheduledStart: detail.service.scheduledStart, activeBibleVersion: detail.service.activeBibleVersion, items, omitted }, null, 2), "application/json; charset=utf-8", "ipresenterplux-service.json");
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    const message = error instanceof Error && status < 500 ? error.message : "Service export failed";
    if (status >= 500) console.error("Service export failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  } finally {
    client.release();
  }
}
