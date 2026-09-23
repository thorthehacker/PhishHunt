import { NextResponse } from "next/server";
import {
  computeEntry,
  flowPageAssembly,
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
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!/^\d+$/.test(String(id || ""))) {
    return new NextResponse("400 Bad Request", {
      status: 400,
      headers: { "Content-Type": TEXT_HTML },
    });
  }

  // Every open of /build/:id counts as a link click on the dashboard.
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

  // Attempt to fetch the visual flow (unauthenticated now).
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
    // Ignore — serve the raw page without flow wiring.
  }

  // Entry node (no slug) = the first page in the flow that has no incoming
  // node-level connection. When there's no flow wiring, the function falls
  // through and the original page is served.
  const entryNode = computeEntry(nodes, connections);

  const html = flowPageAssembly({
    pageId: Number(id),
    pageHtml,
    nodes,
    connections,
    node: entryNode,
    entryNode,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": TEXT_HTML, "Cache-Control": "no-store" },
  });
}
