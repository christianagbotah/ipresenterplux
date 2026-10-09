import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@auth";
import { db } from "@/lib/db";
import { listMediaLibrary } from "@/lib/media-library";

export const dynamic = "force-dynamic";

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function download(body: string, contentType: string, filename: string) {
  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}

function portableLibraryItem(item: Awaited<ReturnType<typeof listMediaLibrary>>["items"][number]) {
  const input = item.plannerInput;
  if (item.itemType === "song") {
    const sections = Array.isArray(input.sections) ? input.sections.map((raw) => {
      const section = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      return {
        label: typeof section.label === "string" ? section.label : "Section",
        text: typeof section.text === "string" ? section.text : ""
      };
    }) : [];
    return {
      type: "song",
      title: item.title,
      author: typeof input.author === "string" ? input.author : null,
      sections,
      defaultSection: typeof input.defaultSection === "number" ? input.defaultSection : null
    };
  }
  if (item.itemType === "slide") {
    return {
      type: "slide",
      title: item.title,
      body: typeof input.body === "string" ? input.body : "",
      footer: typeof input.footer === "string" ? input.footer : null,
      style: typeof input.style === "string" ? input.style : "default"
    };
  }
  return {
    type: "media",
    title: item.title,
    mediaKind: typeof input.mediaKind === "string" ? input.mediaKind : null,
    sourceName: item.source?.name ?? null,
    sourceType: item.source?.type ?? null,
    previewEligibility: item.previewEligibility
  };
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "Authentication required" }, { status: 401 });
  if (session.user.forcePasswordChange) return NextResponse.json({ ok: false, error: "Password change required" }, { status: 403 });

  const url = new URL(request.url);
  const organizationId = url.searchParams.get("organizationId") ?? "";
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (!z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json({ ok: false, error: "Invalid organization id" }, { status: 400 });
  }
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ ok: false, error: "Export format must be json or csv" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    const items: Awaited<ReturnType<typeof listMediaLibrary>>["items"] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const page = await listMediaLibrary(client, session.user.id, { organizationId, limit: 100, offset });
      items.push(...page.items);
      if (page.items.length < 100) break;
    }

    if (format === "csv") {
      const rows = [["title", "section", "text"]];
      for (const item of items) {
        if (item.itemType !== "song") continue;
        const sections = Array.isArray(item.plannerInput.sections) ? item.plannerInput.sections : [];
        for (const raw of sections) {
          const section = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
          rows.push([
            item.title,
            typeof section.label === "string" ? section.label : "Section",
            typeof section.text === "string" ? section.text : ""
          ]);
        }
      }
      return download(rows.map((row) => row.map(csvCell).join(",")).join("\n"), "text/csv; charset=utf-8", "ipresenterplux-songs.csv");
    }

    return download(JSON.stringify({
      version: 1,
      type: "ipresenterplux-library",
      exportedAt: new Date().toISOString(),
      organizationId,
      items: items.map(portableLibraryItem)
    }, null, 2), "application/json; charset=utf-8", "ipresenterplux-library.json");
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    const message = error instanceof Error && status < 500 ? error.message : "Library export failed";
    if (status >= 500) console.error("Library export failed", error);
    return NextResponse.json({ ok: false, error: message }, { status });
  } finally {
    client.release();
  }
}
