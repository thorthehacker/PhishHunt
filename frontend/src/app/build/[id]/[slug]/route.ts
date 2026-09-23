import { NextResponse } from "next/server";
import {
  computeEntry,
  flowPageAssembly,
  pageSlug,
  type FlowNode,
  type FlowConnection,
} from "@/lib/flowRuntime";

export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const TEXT_HTML = "text/html; charset=utf-8";

// Fire-and-forget visit tracking so Links Clicked updates in real time.
function trackPageVisit(pageId: number, request: Request): void {
  if (!Number.isInteger(pageId)) return;
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "Unknown";
  try {
    void fetch(`${API_URL}/tracking/page-visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page_id: pageId, ip }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Tracking must never break page delivery.
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; slug: string }> }
) {
  const { id, slug } = await params;

  if (!/^\d+$/.test(String(id || ""))) {
    return new NextResponse("400 Bad Request", {
      status: 400,
      headers: { "Content-Type": TEXT_HTML },
    });
  }

  // Subpages of /build/:id also count as link clicks.
  trackPageVisit(Number(id), request);

  let pageHtml: string;
  try {
    const res = await fetch(`${API_URL}/landing-pages/${id}/page`, { cache: "no-store" });
    if (!res.ok) {
      return new NextResponse(
        res.status === 404 ? "Landing page not found." : "Failed to load landing page.",
        { status: res.status, headers: { "Content-Type": TEXT_HTML } }
      );
    }
    pageHtml = await res.text();
  } catch {
    return new NextResponse("Backend unavailable — is the API running?", {
      status: 502,
      headers: { "Content-Type": TEXT_HTML },
    });
  }

  let nodes: FlowNode[] = [];
  let connections: FlowConnection[] = [];
  try {
    const res = await fetch(`${API_URL}/landing-pages/${id}/flow`, { cache: "no-store" });
    if (res.ok) {
      const body = await res.json();
      nodes = Array.isArray(body.nodes) ? body.nodes : [];
      connections = Array.isArray(body.connections) ? body.connections : [];
    }
  } catch {
    // No flow — fall through to raw page.
  }

  const entryNode = computeEntry(nodes, connections);
  const targetSlug = decodeURIComponent(slug || "").toLowerCase().replace(/[-_]+/g, "-").replace(/^-|-$/g, "");

  // Resolve the page node by slug. Must mirror flowRuntime.pageSlug so builder
  // and resolver agree even when several nodes share a label ("login").
  const targetNode =
    nodes.find(
      (n) =>
        (n.type === "preview" || n.type === "new_page") &&
        pageSlug(nodes, n) === targetSlug
    ) || null;

  if (!targetNode) {
    return new NextResponse("404 Page not found.", {
      status: 404,
      headers: { "Content-Type": TEXT_HTML },
    });
  }

  const html = flowPageAssembly({
    pageId: Number(id),
    pageHtml,
    nodes,
    connections,
    node: targetNode,
    entryNode,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": TEXT_HTML, "Cache-Control": "no-store" },
  });
}
