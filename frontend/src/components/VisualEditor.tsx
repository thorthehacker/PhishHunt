"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, Save, Trash2, Upload, Lock, Unlock, FileCode2,
  MousePointerClick, Globe, Eye, Pencil, Check, Pointer,
  Play, MoveRight, Loader2, Minimize2, Crosshair, Zap, PenTool,
  StickyNote, ArrowDownRight
} from "lucide-react";
import api from "@/lib/api";

// ────────────────────────────────────────────────────────────────
// TYPES
// ────────────────────────────────────────────────────────────────

type NodeType = "preview" | "new_page" | "capture" | "url" | "do_nothing" | "note";

// Notes cap: hard char limit per note box.
const NOTE_MAX_CHARS = 2000;

interface FlowNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, any>;
}

interface FlowConnection {
  id: string;
  sourceNodeId: string;
  sourceButtonSelector: string; // "" = node-level output (non-button)
  targetNodeId: string;
  label?: string; // button text when from a button
  type?: "df"; // Dynamic Fetching value pipe (input → text/input element)
  sourceSelector?: string; // input field selector on the source page
  targetSelector?: string; // target element selector on the target page
}

type DfMark = { kind: "text" | "input"; value?: string };
type DfMarks = Record<string, DfMark>;

interface DfContextState {
  nodeId: string;
  selector: string;
  kind: "text" | "input";
  text: string;
  x: number;
  y: number;
  marked: boolean;
}

interface ButtonInfo {
  selector: string;
  text: string;
  rect: { x: number; y: number; w: number; h: number };
}

interface PopupState {
  selector: string;
  text: string;
  x: number;
  y: number;
  sourceNodeId: string;
  rect?: { x: number; y: number; w: number; h: number };
}

type ActionId = "new_page" | "link" | "capture" | "url" | "do_nothing";

interface VisualEditorProps {
  page: { id: number; name: string; html_content: string };
  onClose: () => void;
  onSaved?: (nodes: FlowNode[], connections: FlowConnection[]) => void;
}

// ────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────

const CANVAS_W = 2500;
const CANVAS_H = 1500;
const TITLE_BAR_H = 42;
const HTML_DEFAULT = { w: 1920, h: 1080 };
const VIEWPORT_LANDSCAPE = { w: 1920, h: 1080 };
const VIEWPORT_PORTRAIT = { w: 1080, h: 1920 };
type Ratio = "16:9" | "9:16";

// ────────────────────────────────────────────────────────────────
// SITE BUNDLER — merges a picked .html page + its .css/.js/images/
// fonts into ONE self-contained HTML doc (inline <style>/<script>,
// base64 images/fonts). Files of any other type are ignored.
// ────────────────────────────────────────────────────────────────

const SITE_TEXT_EXT = new Set(["css", "js", "mjs"]);
const SITE_BIN_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico",
  "woff", "woff2", "ttf", "otf", "eot",
]);
const SITE_ALLOWED_EXT = new Set(["html", "htm", ...SITE_TEXT_EXT, ...SITE_BIN_EXT]);

const fileExt = (name: string) => (name.split(".").pop() || "").toLowerCase();
const fileBase = (name: string) => (name.split(/[\\/]/).pop() || name).toLowerCase();

const readFileText = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsText(f);
  });

const readFileDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** Rewrites url(...) refs in CSS text to base64 data URIs whenever the
 *  referenced file was selected (matched by basename). */
function inlineCssAssets(cssText: string, assets: Map<string, string>): string {
  return cssText.replace(/url\(\s*(['"]?)([^'"]+?)\1\s*\)/gi, (full, q: string, ref: string) => {
    const clean = ref.split(/[?#]/)[0].trim();
    if (!clean || /^(?:data:|https?:|blob:|#|\/\/)/i.test(clean)) return full;
    const data = assets.get(fileBase(clean));
    return data ? `url("${data}")` : full;
  });
}

/** Bundles the chosen site files into one self-contained HTML document.
 *  Returns null when no .html entry was selected. */
async function bundleSiteFiles(files: File[]): Promise<{ html: string; label: string } | null> {
  const kept = files.filter((f) => SITE_ALLOWED_EXT.has(fileExt(f.name)));
  const htmls = kept.filter((f) => /\.html?$/i.test(f.name));
  if (htmls.length === 0) return null;
  const entry =
    htmls.find((f) => /^index\.html?$/i.test(f.name)) ||
    htmls.find((f) => /^login\.html?$/i.test(f.name)) ||
    htmls[0];

  const cssMap = new Map<string, string>();
  const jsMap = new Map<string, string>();
  const assets = new Map<string, string>(); // basename → data URL (images/icons/fonts)

  await Promise.all(
    kept.map(async (f) => {
      const ext = fileExt(f.name);
      const key = fileBase(f.name);
      if (SITE_TEXT_EXT.has(ext)) {
        const text = await readFileText(f);
        if (ext === "css") cssMap.set(key, text);
        else jsMap.set(key, text);
      } else if (SITE_BIN_EXT.has(ext)) {
        assets.set(key, await readFileDataUrl(f));
      }
    })
  );

  const cssFrom = (ref: string) => {
    const clean = ref.split(/[?#]/)[0].trim();
    return clean ? cssMap.get(fileBase(clean)) : undefined;
  };
  const scriptFrom = (ref: string) => {
    const clean = ref.split(/[?#]/)[0].trim();
    return clean && !/^(?:https?:|\/\/)/i.test(clean) ? jsMap.get(fileBase(clean)) : undefined;
  };
  const assetFrom = (ref: string) => {
    const clean = ref.split(/[?#]/)[0].trim();
    if (!clean || /^(?:data:|https?:|blob:|#|\/\/)/i.test(clean)) return undefined;
    return assets.get(fileBase(clean));
  };

  const doc = new DOMParser().parseFromString(await readFileText(entry), "text/html");

  // Link stylesheets → inline <style>, rewriting nested url() refs to data URIs.
  doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach((el) => {
    const css = cssFrom(el.getAttribute("href") || "");
    if (css == null) return;
    const style = doc.createElement("style");
    style.textContent = inlineCssAssets(css, assets);
    el.replaceWith(style);
  });
  // Existing <style> blocks + inline style attributes.
  doc.querySelectorAll("style").forEach((el) => {
    if (el.textContent) el.textContent = inlineCssAssets(el.textContent, assets);
  });
  doc.querySelectorAll("[style]").forEach((el) => {
    const inline = el.getAttribute("style");
    if (inline) el.setAttribute("style", inlineCssAssets(inline, assets));
  });

  // Icons and binary <src> attributes.
  doc.querySelectorAll('link[rel~="icon"][href], link[rel~="apple-touch-icon"][href]').forEach((el) => {
    const data = assetFrom(el.getAttribute("href") || "");
    if (data) el.setAttribute("href", data);
  });
  doc.querySelectorAll("img[src], input[src], source[src], video[src], audio[src], track[src], embed[src]").forEach((el) => {
    const data = assetFrom(el.getAttribute("src") || "");
    if (data) el.setAttribute("src", data);
  });
  doc.querySelectorAll("[poster]").forEach((el) => {
    const data = assetFrom(el.getAttribute("poster") || "");
    if (data) el.setAttribute("poster", data);
  });

  // Inline local scripts (external http(s) scripts stay untouched).
  doc.querySelectorAll("script[src]").forEach((el) => {
    const js = scriptFrom(el.getAttribute("src") || "");
    if (js == null) return;
    const s = doc.createElement("script");
    const t = (el.getAttribute("type") || "").toLowerCase();
    if (t && !/text\/javascript|application\/javascript/.test(t)) s.setAttribute("type", t);
    s.appendChild(doc.createTextNode(js));
    el.replaceWith(s);
  });

  // Server-side form handlers (login.php etc.) can't run here — drop the action.
  doc.querySelectorAll("form[action]").forEach((el) => {
    const a = (el.getAttribute("action") || "").split(/[?#]/)[0].toLowerCase();
    if (/\.(?:php|asp|aspx|jsp|pl|cgi)$/.test(a)) el.removeAttribute("action");
  });

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>` : "<!DOCTYPE html>";
  return { html: `${doctype}\n${doc.documentElement.outerHTML}`, label: (entry.name.replace(/\.html?$/i, "") || "New Page").trim() };
}

/** Real rendered content extent of a preview iframe. scrollWidth/Height of
 *  <html> reflects the iframe's own size when content is smaller (feedback
 *  loop), so we measure the union of all element boxes instead. */
function measureDocDimensions(doc: Document): { w: number; h: number } {
  let w = 0;
  let h = 0;
  const body = doc.body;
  if (body) {
    const all = Array.from(body.querySelectorAll<HTMLElement>("*"));
    for (const el of all) {
      try {
        const r = el.getBoundingClientRect();
        const right = r.left + r.width;
        const bottom = r.top + r.height;
        if (right > w) w = right;
        if (bottom > h) h = bottom;
      } catch {}
    }
    try {
      const br = body.getBoundingClientRect();
      if (br.width > w) w = br.width;
      if (br.height > h) h = br.height;
    } catch {}
  }
  return {
    w: Math.max(10, Math.min(w + 8, 4096)),
    h: Math.max(10, Math.min(h + 8, 4096)),
  };
}

// Preview / New Page nodes are always 16:9.
const NODE_DEFAULTS: Record<NodeType, { width: number; height: number; label: string }> = {
  preview: { width: 480, height: 270, label: "Starting Page" },
  new_page: { width: 400, height: 225, label: "New Page" },
  capture: { width: 230, height: 104, label: "Capture Details" },
  url: { width: 230, height: 104, label: "URL" },
  do_nothing: { width: 210, height: 96, label: "Do Nothing" },
  note: { width: 250, height: 190, label: "Note" },
};

const ACTION_META: Record<ActionId, { label: string; color: string; dot: string }> = {
  new_page: { label: "New Page", color: "#3b82f6", dot: "bg-blue-500" },
  link: { label: "String", color: "#8b5cf6", dot: "bg-violet-500" },
  capture: { label: "Capture Details", color: "#ef4444", dot: "bg-red-500" },
  url: { label: "URL", color: "#f59e0b", dot: "bg-amber-500" },
  do_nothing: { label: "Do Nothing", color: "#71717a", dot: "bg-zinc-500" },
};

// ────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────

let idCounter = 0;
export function uid(prefix = "n"): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

function bezierPath(sx: number, sy: number, tx: number, ty: number): string {
  const dx = Math.max(60, Math.abs(tx - sx) * 0.45);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

// Page previews render at a fixed full-HD-ish viewport so the page's own
// layout/wrapping is stable, then the iframe is scaled to fit the node.
function viewportFor(n: FlowNode): { w: number; h: number } {
  if (n.type === "preview" || n.type === "new_page") {
    return n.data?.ratio === "9:16" ? VIEWPORT_PORTRAIT : VIEWPORT_LANDSCAPE;
  }
  return HTML_DEFAULT;
}

// Height that keeps the given node at its selected page ratio (16:9 or 9:16).
function aspectH(w: number, ratio?: string): number {
  return ratio === "9:16" ? Math.round((w * 16) / 9) : Math.round((w * 9) / 16);
}

// Scale that FILLS the node's content box (mimics a 1920x1080 window: no
// letterbox bars). The viewport is scaled to cover the box, cropping the
// overflow the way a real browser window would; the iframe is anchored at
// the content-box top-left so connector/popup math stays exact.
function fillScaleFor(vp: { w: number; h: number }, cw: number, ch: number): number {
  return Math.max(cw / vp.w, ch / vp.h);
}

function nodeLeftConnector(n: FlowNode) {
  return { x: n.x, y: n.y + n.height / 2 };
}

function nodeRightConnector(n: FlowNode) {
  return { x: n.x + n.width, y: n.y + n.height / 2 };
}

const BRIDGE_SCRIPT = `<script>
(function() {
  'use strict';
  var NODE_ID = '__NODE_ID__';
  window.__BRIDGE_NODE_ID__ = NODE_ID;
  window.__BRIDGE_DF_ENABLED__ = function() { return DF_ENABLED; };
  window.__BRIDGE_DF_COUNT__ = 0;
  var VIEW_W = __VIEW_W__;
  var VIEW_H = __VIEW_H__;
  var CLICK_SEL = 'button, input[type="submit"], input[type="button"], [role="button"], a[href], .btn, [onclick]:not(input):not(select), [aria-label*="log in" i], [aria-label*="sign in" i], [aria-label*="signin" i], [data-testid*="login" i], [data-testid*="signin" i]';
  var TEXT_TAG = /^(p|span|div|h1|h2|h3|h4|h5|h6|li|a|label|strong|b|em|small|figcaption|td|th)$/i;
  var DF_ENABLED = false;
  var DF_MARKS = {};
  var lastHover = null;
  var hoverX = 0, hoverY = 0, hoverPending = false;
  function removeDisabled() {
    var els = document.querySelectorAll('[disabled]');
    for (var i = 0; i < els.length; i++) els[i].removeAttribute('disabled');
  }
  function currentDims() {
    return { w: VIEW_W, h: VIEW_H };
  }
  function getSelector(el) {
    if (el.id) return '#' + el.id;
    var path = [];
    while (el && el.nodeType === 1) {
      var sel = el.tagName.toLowerCase();
      if (el.id) { path.unshift('#' + el.id); break; }
      var parent = el.parentElement;
      if (!parent) break;
      var same = [];
      var kids = Array.prototype.slice.call(parent.children);
      for (var k = 0; k < kids.length; k++) {
        if (kids[k].tagName === el.tagName) same.push(kids[k]);
      }
      var idx = same.indexOf(el) + 1;
      sel += ':nth-of-type(' + idx + ')';
      path.unshift(sel);
      el = parent;
    }
    return path.join(' > ');
  }
  function isClickable(t) {
    return !!t.closest(CLICK_SEL);
  }
  // Structural (real) control: button/a/[role=button]/submit-like. Used by
  // dfCandidate so an INPUT nested inside a DIALOG whose aria-label mentions
  // "log in"/"sign in" is still treated as a DF target — the aria-keyword
  // checks in CLICK_SEL must not block form fields living in the dialog.
  function isStructuralControl(t) {
    return !!t.closest('button, a[href], [role="button"], input[type="submit"], input[type="button"], input[type="image"], .btn, [onclick]:not(input):not(select)');
  }
  // Types DF never targets (secrets / controls / non-text fields).
  function isSkippedFieldType(t) {
    return t === 'hidden' || t === 'password' || t === 'submit' || t === 'button' ||
      t === 'image' || t === 'file' || t === 'checkbox' || t === 'radio' ||
      t === 'range' || t === 'color' || t === 'reset';
  }
  function fieldType(f) {
    return String(f.type || (f.tagName === 'textarea' ? 'textarea' : f.tagName === 'select' ? 'select' : 'text')).toLowerCase();
  }
  // Deepest meaningful DF target: a real input/textarea/select (never password —
  // DF pipes email/username/phone, not secrets) OR a leaf text-ish element.
  function dfCandidate(el) {
    if (!el || el.nodeType !== 1 || !el.closest) return null;
    var tag = el.tagName.toLowerCase();

    // A real fillable field on its own.
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      var type = fieldType(el);
      if (isSkippedFieldType(type)) return null;
      return { kind: 'input', sel: getSelector(el), text: String(el.value || '') };
    }

    // Hidden-input widget (X/Google-style): the visible wrapper is clickable but
    // the actual value-bearing field is a real input/textarea nested below it.
    // Resolve the FIRST fillable (non-skipped) field inside the wrapper — run
    // BEFORE the structural/clickable guards, since these wrappers are themselves
    // clickable (role=link/button overlays) and would otherwise never be
    // selectable as a DF target. Bounded scan, never loops.
    var fields = el.querySelectorAll ? el.querySelectorAll('input, textarea, select') : null;
    if (fields && fields.length) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        if (!isSkippedFieldType(fieldType(f))) {
          return { kind: 'input', sel: getSelector(f), text: String(f.value || '') };
        }
      }
    }

    // Real controls (buttons/links) are wired as buttons, not DF targets.
    if (isStructuralControl(el)) return null;
    // Login dialogs and other aria-keyword clickable containers must not be
    // mistaken for DF targets either.
    if (isClickable(el)) return null;

    // A leaf text element.
    if (TEXT_TAG.test(tag) && el.childElementCount === 0) {
      var txt = (el.textContent || '').trim();
      var sel2 = getSelector(el);
      // Already-marked text stays selectable even after it's emptied, so the
      // user can double-click it again later to re-edit.
      if (!txt && !DF_MARKS[sel2]) return null;
      return { kind: 'text', sel: sel2, text: txt };
    }
    // A collapsed (emptied) marked text inside its parent: resolve one level
    // down so the user can click the surrounding element to re-open the editor.
    if (el.childElementCount === 1) {
      var only = el.firstElementChild;
      var ok2 = only && TEXT_TAG.test(only.tagName.toLowerCase()) && only.childElementCount === 0;
      if (ok2 && DF_MARKS[getSelector(only)]) {
        return { kind: 'text', sel: getSelector(only), text: (only.textContent || '').trim() };
      }
    }
    return null;
  }
  function dfRects() {
    var rects = {};
    Object.keys(DF_MARKS).forEach(function(sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) {
        // Empty-but-marked text keeps a minimal box so it stays visible/editable.
        rects[sel] = { x: r.x, y: r.y, w: 2, h: 2 };
        return;
      }
      rects[sel] = { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    return rects;
  }
  function applyDfTexts() {
    Object.keys(DF_MARKS).forEach(function(sel) {
      var mk = DF_MARKS[sel] || {};
      if (mk.kind !== 'text' || typeof mk.value !== 'string') return;
      var el = document.querySelector(sel);
      if (!el) return;
      try {
        if (String(el.textContent || '') !== mk.value) el.textContent = mk.value;
      } catch (err) {}
    });
  }
  function setMarks(marks) {
    var next = marks || {};
    var prevKey = JSON.stringify(DF_MARKS);
    var nextKey = JSON.stringify(next);
    DF_MARKS = next;
    applyDfTexts();
    if (prevKey === nextKey) return;
    try {
      window.parent.postMessage({ type: '__PH_DF_RECTS', nodeId: NODE_ID, rects: dfRects() }, '*');
    } catch (err) {}
  }
  // Listen at window capture: injected first into <head>, so we beat any page
  // window-capture listener that stops propagation on click/contextmenu/dblclick.
  window.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || !target.closest) return;
    if (DF_ENABLED) {
      var cand = dfCandidate(target);
      if (cand) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        var cr = target.getBoundingClientRect();
        window.parent.postMessage({
          type: '__PH_ELEMENT_CLICK',
          nodeId: NODE_ID,
          selector: cand.sel,
          kind: cand.kind,
          text: cand.text,
          rect: { x: cr.x, y: cr.y, w: cr.width, h: cr.height },
          dims: currentDims()
        }, '*');
        return;
      }
    }
    if (!isClickable(target)) return;
    var btn = target.closest(CLICK_SEL);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var rect = btn.getBoundingClientRect();
    window.parent.postMessage({
      type: '__PH_BUTTON_CLICK',
      nodeId: NODE_ID,
      selector: getSelector(btn),
      text: (btn.textContent ? btn.textContent.trim() : (btn.value || '')).substring(0, 60),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      dims: currentDims()
    }, '*');
  }, true);
  window.addEventListener('contextmenu', function(e) {
    if (!DF_ENABLED) return;
    var cand = dfCandidate(e.target);
    if (!cand) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var r = e.target.getBoundingClientRect();
    window.parent.postMessage({
      type: '__PH_ELEMENT_CTXMENU',
      nodeId: NODE_ID,
      selector: cand.sel,
      kind: cand.kind,
      text: cand.text,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      dims: currentDims()
    }, '*');
  }, true);
  window.addEventListener('dblclick', function(e) {
    if (!DF_ENABLED) return;
    var cand = dfCandidate(e.target);
    if (!cand) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var r = e.target.getBoundingClientRect();
    window.parent.postMessage({
      type: '__PH_ELEMENT_DBLCLICK',
      nodeId: NODE_ID,
      selector: cand.sel,
      kind: cand.kind,
      text: cand.text,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      dims: currentDims()
    }, '*');
  }, true);
  function emitHover() {
    hoverPending = false;
    try {
      if (!DF_ENABLED) {
        // Dev tools are off: make sure the parent has no stale highlight.
        if (lastHover !== null) {
          lastHover = null;
          window.parent.postMessage({ type: '__PH_HOVER', nodeId: NODE_ID, selector: null, rect: null, dims: currentDims() }, '*');
        }
        return;
      }
      var s = window.getSelection();
      if (s && String(s).length) return;
      var el = document.elementFromPoint(hoverX, hoverY);
      var cand = el ? dfCandidate(el) : null;
      var sig = cand ? cand.sel + '|' + cand.kind : null;
      if (sig === lastHover) return;
      lastHover = sig;
      if (!cand) {
        window.parent.postMessage({ type: '__PH_HOVER', nodeId: NODE_ID, selector: null, rect: null, dims: currentDims() }, '*');
        return;
      }
      // Measure the CANDIDATE element (not the hovered wrapper) so the box
      // hugs the real text/input exactly.
      var target = document.querySelector(cand.sel);
      var r = target ? target.getBoundingClientRect() : el.getBoundingClientRect();
      if (!r.width && !r.height) { var rr = el.getBoundingClientRect(); r = rr; }
      window.parent.postMessage({
        type: '__PH_HOVER',
        nodeId: NODE_ID,
        selector: cand.sel,
        kind: cand.kind,
        text: cand.text,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        dims: currentDims()
      }, '*');
    } catch (err) {}
  }
  window.addEventListener('mousemove', function(e) {
    hoverX = e.clientX;
    hoverY = e.clientY;
    // Forward the raw pointer so the parent can drag the DF ghost string
    // smoothly even while the cursor is inside this iframe (where the parent's
    // own mousemove never fires).
    if (DF_ENABLED) {
      window.parent.postMessage({ type: '__PH_DF_POINTER', nodeId: NODE_ID, x: hoverX, y: hoverY }, '*');
    }
    if (hoverPending) return;
    hoverPending = true;
    requestAnimationFrame(emitHover);
  }, true);
  document.addEventListener('mouseleave', function() {
    lastHover = null;
    window.parent.postMessage({ type: '__PH_HOVER', nodeId: NODE_ID, selector: null, rect: null, dims: currentDims() }, '*');
  });
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || !d.nodeId || String(d.nodeId) !== NODE_ID) return;
    if (d.type === '__PH_DF_MODE') DF_ENABLED = !!d.on;
    if (d.type === '__PH_DF_MARKS') setMarks(d.marks);
  });
  function announce() {
    var p = { type: '__PH_PAGE_DIMS', nodeId: NODE_ID, w: currentDims().w, h: currentDims().h };
    window.parent.postMessage(p, '*');
    try {
      var rects = {};
      var els = document.querySelectorAll(CLICK_SEL);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        rects[getSelector(el)] = { x: r.x, y: r.y, w: r.width, h: r.height };
      }
      window.parent.postMessage({ type: '__PH_BUTTON_RECTS', nodeId: NODE_ID, rects: rects }, '*');
      var drects = dfRects();
      if (Object.keys(drects).length) {
        window.parent.postMessage({ type: '__PH_DF_RECTS', nodeId: NODE_ID, rects: drects }, '*');
      }
    } catch (err) {}
  }
  var rafPending = false;
  function scheduleAnnounce() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function() {
      rafPending = false;
      try { announce(); } catch (err) {}
    });
  }
  document.addEventListener('scroll', scheduleAnnounce, true);
  window.addEventListener('resize', scheduleAnnounce, true);
  document.addEventListener('DOMContentLoaded', function() {
    removeDisabled();
    var btns = document.querySelectorAll(CLICK_SEL);
    window.parent.postMessage({ type: '__PH_BUTTONS_READY', count: btns.length }, '*');
  });
  if (document.readyState === 'complete') { removeDisabled(); }
  else if (document.readyState !== 'loading') { removeDisabled(); }
  setTimeout(function() {
    try {
      removeDisabled();
      announce();
    } catch (err) {}
  }, 150);
  window.addEventListener('load', function() {
    try { setTimeout(announce, 250); } catch (err) {}
  });
})();
<\/script>`;

function injectBridge(html: string, nodeId: string, vw: number, vh: number): string {
  const script = BRIDGE_SCRIPT.replace("__NODE_ID__", nodeId)
    .replace("__VIEW_W__", String(vw))
    .replace("__VIEW_H__", String(vh));
  // Inject at the very top of <head> (or the doc) so this bridge registers its
  // capture-phase document listeners before ANY page script — pages that swallow
  // clicks with their own stopImmediatePropagation must not beat us.
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${script}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}${script}`);
  }
  return script + html;
}

/**
 * Valid action additions given the actions a button already has.
 *   - "new_page", "link" and "url" are mutually exclusive (one navigation)
 *   - "do_nothing" excludes every navigation (new_page/url/link) but can be
 *     combined with "capture" (submit is neutralised AND credentials logged)
 *   - "capture" can combine with exactly one navigation or with "do_nothing"
 */
function getAvailableActions(existingTypes: string[]): ActionId[] {
  const has = (t: string) => existingTypes.includes(t);
  const nav = existingTypes.some((t) => t === "new_page" || t === "url" || t === "preview");
  if (has("do_nothing")) return has("capture") ? [] : ["capture"];
  if (nav) return has("capture") ? [] : ["capture"];
  if (has("capture")) return ["link", "new_page", "url", "do_nothing"];
  return ["link", "new_page", "capture", "url", "do_nothing"];
}

function nodeTypeOfAction(a: ActionId): NodeType {
  if (a === "new_page") return "new_page";
  if (a === "capture") return "capture";
  if (a === "url") return "url";
  return "do_nothing";
}

// Connection line color: page targets (preview / new_page) are STRING links.
function connectionColorFor(tgtType: string): string {
  if (tgtType === "capture") return "#ef4444";
  if (tgtType === "url") return "#f59e0b";
  if (tgtType === "preview" || tgtType === "new_page") return "#8b5cf6";
  return "#71717a";
}

// ────────────────────────────────────────────────────────────────
// BUTTON ACTION POPUP
// ────────────────────────────────────────────────────────────────

function ButtonActionPopup({
  popup, existingTypes, locked, onPick, onToggleLock, onClose,
}: {
  popup: PopupState;
  existingTypes: string[];
  locked: boolean;
  onPick: (a: ActionId) => void;
  onToggleLock: () => void;
  onClose: () => void;
}) {
  const available = getAvailableActions(existingTypes);
  return (
    <div
      className="absolute z-[300] w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
      style={{ left: popup.x, top: popup.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <MousePointerClick className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span className="text-xs font-semibold text-white truncate">Button action</span>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-zinc-800/60">
        <p className="text-[10px] text-zinc-500 font-mono truncate">{popup.selector}</p>
        <p className="text-[11px] text-zinc-400 truncate">{popup.text || "unnamed button"}</p>
      </div>

      <div className="p-2 space-y-1">
        {available.length === 0 ? (
          <p className="text-[11px] text-zinc-500 px-2 py-2 text-center">
            No more valid actions for this button.
          </p>
        ) : (
          available.map((a) => (
            <button
              key={a}
              onClick={() => onPick(a)}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
            >
              <span className={`w-2.5 h-2.5 rounded-full ${ACTION_META[a].dot}`} />
              <span className="text-xs font-medium text-zinc-200">{ACTION_META[a].label}</span>
            </button>
          ))
        )}
      </div>

      <div className="px-3 py-2.5 border-t border-zinc-800 flex items-center justify-between">
        <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Button state</span>
        <button
          onClick={onToggleLock}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-medium transition-colors
            ${locked
              ? "bg-red-950/50 border-red-900/60 text-red-400"
              : "bg-zinc-800 border-zinc-700 text-zinc-300"}`}
        >
          {locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
          {locked ? "Locked" : "Unlocked"}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// NODE SHELL
// ────────────────────────────────────────────────────────────────

function connectorDot({
  x, y, color, onMouseDown, onMouseUp, onClick, onContextMenu, title, dotKey,
}: {
  x: number; y: number; color: string;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title: string;
  dotKey?: string;
}) {
  return (
    <div
      key={dotKey}
      title={title}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="absolute w-3.5 h-3.5 rounded-full border-2 border-zinc-950 cursor-crosshair transition-transform hover:scale-150 z-20"
      style={{ left: x, top: y, backgroundColor: color, transform: "translate(-50%,-50%)" }}
    />
  );
}

/** Anchor a button's connector lines. When the page is scrolled inside the panel
 *  (scrollable pages) the button's rect can leave the visible content box; the
 *  connector is then parked at the panel's vertical centre (still following the
 *  button's x) so it never floats outside the panel. It slides back onto the
 *  button the moment the button scrolls back into view. Coordinates are pixel
 *  positions inside the node's content area (below the title bar). */
function clampedConnectorAnchor(
  rect: { x: number; y: number; w: number; h: number },
  contentW: number,
  contentH: number,
  scale: number,
  offsetX = 4
): { sx: number; sy: number } {
  const sx0 = offsetX + (rect.x + rect.w / 2) * scale;
  const sy0 = (rect.y + rect.h / 2) * scale;
  const m = 12;
  const visibleX = sx0 >= m && sx0 <= contentW - m;
  const visibleY = sy0 >= m && sy0 <= contentH - m;
  if (visibleX && visibleY) return { sx: sx0, sy: sy0 };
  return { sx: Math.max(m, Math.min(contentW - m, sx0)), sy: contentH / 2 };
}

// ────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ────────────────────────────────────────────────────────────────

export default function VisualEditor({ page, onClose, onSaved }: VisualEditorProps) {
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [connections, setConnections] = useState<FlowConnection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [tempConn, setTempConn] = useState<{ sx: number; sy: number; tx: number; ty: number } | null>(null);
  const [stringing, setStringing] = useState<{ fromNodeId: string; selector: string; x: number; y: number } | null>(null);
  const [editingUrlNodeId, setEditingUrlNodeId] = useState<string | null>(null);
  const [urlDraft, setUrlDraft] = useState({ label: "", url: "" });
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteLabelDraft, setNoteLabelDraft] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [bundleBusy, setBundleBusy] = useState(false);
  // ── Dynamic Fetching (DF) state ──
  const [dfMode, setDfMode] = useState(false);
  const [dfContext, setDfContext] = useState<DfContextState | null>(null);
  const [dfStringing, setDfStringing] = useState<{ fromNodeId: string; selector: string; x: number; y: number } | null>(null);
  const [dfHover, setDfHover] = useState<{ nodeId: string; selector: string | null; kind: string; text: string; rect: { x: number; y: number; w: number; h: number } } | null>(null);
  const [dfEdit, setDfEdit] = useState<{ nodeId: string; selector: string; kind: "text" | "input"; value: string; x: number; y: number } | null>(null);
  const [dfDraft, setDfDraft] = useState("");
  const [dfToast, setDfToast] = useState<{ msg: string; error: boolean } | null>(null);
  // bump to force re-render when iframe-reported dims change
  const [, setTick] = useState(0);

  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ nodeId: string; startX: number; startY: number; ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ nodeId: string; startX: number; startY: number; ow: number } | null>(null);
  const buttonRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const dfRectsRef = useRef<Map<string, { x: number; y: number; w: number; h: number }>>(new Map());
  const toastTimerRef = useRef<number | null>(null);
  const uploadNodeRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);

  // Entry page node — the page a visitor lands on: a preview/new_page node with
  // no incoming node-level connection (pages chain left-to-right into it).
  const entryNode = useMemo(() => {
    const pageNodes = nodes.filter((n) => n.type === "preview" || n.type === "new_page");
    if (pageNodes.length === 0) return null;
    const incoming = new Set<string>();
    connections.forEach((c) => {
      if (c.type === "df") return; // DF value pipes never chain pages
      if (!c.sourceButtonSelector) incoming.add(c.targetNodeId);
    });
    const candidates = pageNodes.filter((n) => !incoming.has(n.id)).sort((a, b) => a.x - b.x);
    if (candidates.length > 0) return candidates[0];
    return pageNodes.find((n) => n.type === "preview") || pageNodes[0];
  }, [nodes, connections]);

  // ── Derived: buttons per source node ──
  const buttonStateMap = useMemo(() => {
    const map = new Map<string, string[]>();
    connections.forEach((c) => {
      const key = `${c.sourceNodeId}::${c.sourceButtonSelector}`;
      const arr = map.get(key) || [];
      arr.push(c.targetNodeId);
      map.set(key, arr);
    });
    return map;
  }, [connections]);

  const nodeById = useMemo(() => {
    const m = new Map<string, FlowNode>();
    nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [nodes]);

  // ── DF derived state ──
  const dfMarksFor = useCallback(
    (nodeId: string): DfMarks => {
      if (!nodeId) return {};
      return (nodeById.get(nodeId)?.data?.dfMarks as DfMarks | undefined) || {};
    },
    [nodeById]
  );
  const dfConnections = useMemo(() => connections.filter((c) => c.type === "df"), [connections]);

  const showDfToast = useCallback((msg: string, error = false) => {
    setDfToast({ msg, error });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setDfToast(null), 3000);
  }, []);

  const markDf = useCallback((nodeId: string, selector: string, kind: DfMark["kind"], value?: string) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                dfMarks: { ...((n.data?.dfMarks as DfMarks) || {}), [selector]: { kind, ...(value !== undefined ? { value } : {}) } },
              },
            }
          : n
      )
    );
  }, []);

  const unmarkDf = useCallback((nodeId: string, selector: string) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const marks = { ...((n.data?.dfMarks as DfMarks) || {}) };
        delete marks[selector];
        return { ...n, data: { ...n.data, dfMarks: marks } };
      })
    );
  }, []);

  // Push the current DF mode + marks into a node's preview iframe (also sent
  // reactively from the bridge message handler so late-loading frames catch up).
  const sendDfState = useCallback(
    (nodeId: string) => {
      const frames = canvasRef.current?.querySelectorAll(`iframe[data-ph-frame="${nodeId}"]`) || [];
      const marks = dfMarksFor(nodeId);
      frames.forEach((f) => {
        const iframe = f as HTMLIFrameElement;
        try {
          iframe.contentWindow?.postMessage({ type: "__PH_DF_MODE", nodeId, on: dfMode }, "*");
          iframe.contentWindow?.postMessage({ type: "__PH_DF_MARKS", nodeId, marks }, "*");
        } catch {}
      });
    },
    [dfMarksFor, dfMode]
  );

  // ── Load saved flow ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get(`/landing-pages/${page.id}/flow`);
        const savedNodes: FlowNode[] = res.data?.nodes || [];
        const savedConns: FlowConnection[] = res.data?.connections || [];
        if (cancelled) return;
        if (savedNodes.length > 0) {
          const normalized = savedNodes.map((n) => {
            if (n.type === "preview" || n.type === "new_page") {
              const w = Math.max(240, Math.round(n.width || NODE_DEFAULTS[n.type].width));
              return { ...n, width: w, height: Math.max(135, aspectH(w, n.data?.ratio)) };
            }
            return n;
          });
          buttonRectsRef.current = new Map();
          dfRectsRef.current = new Map();
          normalized.forEach((n) => {
            if ((n.type === "preview" || n.type === "new_page") && n.data?.buttons) {
              Object.entries(n.data.buttons).forEach(([sel, rect]) => {
                buttonRectsRef.current.set(`${n.id}::${sel}`, rect as { x: number; y: number; w: number; h: number });
              });
            }
            if ((n.type === "preview" || n.type === "new_page") && n.data?.dfRects) {
              const marks = (n.data?.dfMarks as DfMarks) || {};
              Object.entries(n.data.dfRects).forEach(([sel, rect]) => {
                if (!marks[sel]) return;
                dfRectsRef.current.set(`${n.id}::${sel}`, rect as { x: number; y: number; w: number; h: number });
              });
            }
          });
          setNodes(normalized);
          setConnections(savedConns);
        } else {
          const def = NODE_DEFAULTS.preview;
          setNodes([{
            id: uid("start"),
            type: "preview",
            x: 640,
            y: 560,
            width: def.width,
            height: def.height,
            data: { label: page.name || "Starting Page", ratio: "16:9", buttonStates: {} },
          }]);
        }
        setLoaded(true);
      } catch (err) {
        console.error("Failed to load flow", err);
        const def = NODE_DEFAULTS.preview;
        setNodes([{
          id: uid("start"),
          type: "preview",
          x: 1650,
          y: 850,
          width: def.width,
          height: def.height,
          data: { label: page.name || "Starting Page", ratio: "16:9", buttonStates: {} },
        }]);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [page.id, page.name]);

  // ── Center canvas on the preview node once loaded ──
  useEffect(() => {
    if (!loaded || nodes.length === 0 || !canvasRef.current) return;
    const preview = nodes.find((n) => n.type === "preview");
    const anchor = preview || nodes[0];
    const el = canvasRef.current;
    el.scrollLeft = Math.max(0, anchor.x - (el.clientWidth / 2)) + anchor.width / 2;
    el.scrollTop = Math.max(0, anchor.y - (el.clientHeight / 2)) + anchor.height / 2;
  }, [loaded, canvasRef]);

  // ── Bridge message listener ──
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      const data = e.data;
      if (!data || typeof data !== "object") return;

      // Frames that finish loading after we set marks miss the state push, so
      // re-push on genuine load signals only. Re-pushing on echo messages
      // (__PH_DF_RECTS/__PH_BUTTON_RECTS) creates an infinite ping-pong loop
      // between this listener and the frame's setMarks → dfRects → postMessage.
      if (data.nodeId && (data.type === "__PH_PAGE_DIMS" || data.type === "__PH_BUTTONS_READY")) {
        try {
          sendDfState(data.nodeId);
        } catch {}
      }

      const srcFor = (nodeId: string) =>
        nodeById.get(nodeId) || nodes.find((n) => n.type === "preview") || nodes[0];
      const pointFor = (src: FlowNode, rect: { x: number; y: number; w: number; h: number }) => {
        const vp = viewportFor(src);
        const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
        return {
          x: src.x + 4 + (rect.x + rect.w / 2) * scale,
          y: src.y + TITLE_BAR_H + 4 + (rect.y + rect.h / 2) * scale,
        };
      };

      if (data.type === "__PH_BUTTON_RECTS") {
        const src = srcFor(data.nodeId);
        if (!src) return;
        Object.entries(data.rects || {}).forEach(([sel, rect]) => {
          buttonRectsRef.current.set(`${src.id}::${sel}`, rect as { x: number; y: number; w: number; h: number });
        });
        setTick((t) => t + 1);
      }

      if (data.type === "__PH_DF_RECTS") {
        Object.entries(data.rects || {}).forEach(([sel, rect]) => {
          const marks = dfMarksFor(data.nodeId);
          if (!marks[sel]) return;
          dfRectsRef.current.set(`${data.nodeId}::${sel}`, rect as { x: number; y: number; w: number; h: number });
        });
        setTick((t) => t + 1);
      }

      if (data.type === "__PH_HOVER") {
        if (!dfMode) { setDfHover(null); return; }
        if (!data.selector) {
          setDfHover(null);
          return;
        }
        setDfHover({
          nodeId: data.nodeId,
          selector: data.selector,
          kind: data.kind,
          text: data.text || "",
          rect: { x: data.rect.x, y: data.rect.y, w: data.rect.w, h: data.rect.h },
        });
      }

      if (data.type === "__PH_DF_POINTER") {
        // While a DF string is being dragged, follow the pointer reported by the
        // frame so the ghost stays glued to the cursor even over iframes.
        if (!dfStringing) return;
        const src = srcFor(data.nodeId);
        if (!src) return;
        const vp = viewportFor(src);
        const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
        const tx = src.x + 4 + data.x * scale;
        const ty = src.y + TITLE_BAR_H + 4 + data.y * scale;
        setTempConn({ sx: dfStringing.x, sy: dfStringing.y, tx, ty });
      }

      if (data.type === "__PH_ELEMENT_CTXMENU") {
        if (!dfMode) return;
        const src = srcFor(data.nodeId);
        if (!src) return;
        const pt = pointFor(src, data.rect);
        const marked = !!dfMarksFor(src.id)[data.selector];
        setPopup(null);
        setEditingUrlNodeId(null);
        setDfContext({ nodeId: src.id, selector: data.selector, kind: data.kind, text: data.text || "", x: pt.x, y: pt.y, marked });
      }

      if (data.type === "__PH_ELEMENT_CLICK") {
        if (!dfMode) return;
        const src = srcFor(data.nodeId);
        if (!src) return;
        const pt = pointFor(src, data.rect);

        if (dfStringing) {
          if (dfStringing.fromNodeId === src.id) {
            showDfToast("Drop the connector on an element of another page", true);
            return;
          }
          completeDfString(dfStringing.fromNodeId, dfStringing.selector, src.id, data.selector, data.kind, data.text);
          return;
        }
        // Clicks only COMPLETE a string (or are ignored). Strings START from
        // the dedicated DF connector dot on a marked input — not from clicking
        // anywhere on the page.
      }

      if (data.type === "__PH_ELEMENT_DBLCLICK") {
        if (!dfMode || data.kind !== "text") return;
        const src = srcFor(data.nodeId);
        if (!src) return;
        const marks = dfMarksFor(data.nodeId) || {};
        const existing = marks[data.selector];
        const cur = existing?.kind === "text" && existing.value != null ? existing.value : (data.text || "");
        if (!existing) markDf(data.nodeId, data.selector, "text", cur);
        const pt = pointFor(src, data.rect);
        setDfEdit({ nodeId: data.nodeId, selector: data.selector, kind: "text", value: cur, x: pt.x, y: pt.y });
        setDfDraft(cur);
        setDfContext(null);
        setDfHover(null);
      }

      if (data.type === "__PH_BUTTON_CLICK") {
        const src = srcFor(data.nodeId);
        if (!src) return;
        buttonRectsRef.current.set(`${src.id}::${data.selector}`, data.rect);
        setTick((t) => t + 1);
        if (dfMode) return; // DF mode is exclusive with button wiring
        const vp = viewportFor(src);
        const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
        const bx = src.x + 4 + (data.rect.x + data.rect.w / 2) * scale;
        const by = src.y + TITLE_BAR_H + 4 + (data.rect.y + data.rect.h / 2) * scale;
        const budget = 240;
        setPopup({
          selector: data.selector,
          text: data.text,
          x: Math.max(12, Math.min(CANVAS_W - budget - 24, bx + 16)),
          y: Math.max(12, Math.min(CANVAS_H - 260, by - 84)),
          sourceNodeId: src.id,
          rect: data.rect,
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, buttonStateMap, nodeById, dfMode, dfStringing, sendDfState, dfMarksFor, markDf, showDfToast]);

  // ── Canvas mouse handlers (drag / connect) ──
  const onCanvasMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (dragRef.current) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left + canvas.scrollLeft;
      const cy = e.clientY - rect.top + canvas.scrollTop;
      const d = dragRef.current;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === d.nodeId
            ? { ...n, x: Math.max(0, Math.min(CANVAS_W - n.width, cx - d.ox)), y: Math.max(0, Math.min(CANVAS_H - n.height, cy - d.oy)) }
            : n
        )
      );
      return;
    }

    if (stringing) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left + canvas.scrollLeft;
      const cy = e.clientY - rect.top + canvas.scrollTop;
      setTempConn({ sx: stringing.x, sy: stringing.y, tx: cx, ty: cy });
      return;
    }

    if (dfStringing) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left + canvas.scrollLeft;
      const cy = e.clientY - rect.top + canvas.scrollTop;
      setTempConn({ sx: dfStringing.x, sy: dfStringing.y, tx: cx, ty: cy });
    }
  };

  const onCanvasMouseUp = () => {
    endInteraction();
  };

  const endInteraction = () => {
    dragRef.current = null;
    // DF stringing completes on an element click, not on mouseup. When the
    // cursor leaves the canvas the ghost SNAPS BACK to its connector (the
    // source dot stays visible, the string retracts) and resumes following
    // the pointer the moment it re-enters, exactly like button stringing.
    setTempConn(null);
  };

  const cancelStringing = () => {
    setStringing(null);
    setTempConn(null);
  };

  const cancelDfStringing = () => {
    setDfStringing(null);
    setTempConn(null);
  };

  // Finish a DF connection: the clicked element is auto-marked (text keeps its
  // current hardcoded text as the default), the yellow value pipe is created.
  const completeDfString = (
    fromNodeId: string,
    sourceSelector: string,
    targetNodeId: string,
    targetSelector: string,
    targetKind: string,
    targetText: string
  ) => {
    if (fromNodeId === targetNodeId) {
      showDfToast("Connect the input to an element on another page", true);
      cancelDfStringing();
      return;
    }
    if (
      connections.some(
        (c) =>
          c.type === "df" &&
          c.sourceNodeId === fromNodeId &&
          c.sourceSelector === sourceSelector &&
          c.targetNodeId === targetNodeId &&
          c.targetSelector === targetSelector
      )
    ) {
      showDfToast("This connection already exists", true);
      cancelDfStringing();
      return;
    }
    if (targetKind === "text") markDf(targetNodeId, targetSelector, "text", targetText || undefined);
    else markDf(targetNodeId, targetSelector, "input");
    setConnections((prev) => [
      ...prev,
      { id: uid("dfc"), type: "df", sourceNodeId: fromNodeId, sourceSelector, sourceButtonSelector: "", targetNodeId, targetSelector },
    ]);
    showDfToast("Dynamic Fetching connection added");
    cancelDfStringing();
  };

  const startNodeDrag = (nodeId: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const n = nodeById.get(nodeId);
    if (!n) return;
    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      ox: e.clientX - rect.left + canvas.scrollLeft - n.x,
      oy: e.clientY - rect.top + canvas.scrollTop - n.y,
    };
  };

  // Resize preview / new_page corners while keeping 16:9. Pointer capture is
// claimed on the handle at mousedown so mousemove/mouseup are delivered to the
// handle even when the pointer travels over a preview IFRAME (iframe capture
// would otherwise steal the parent's mouseup and the panel would keep resizing
// on later mouse moves — releasing must always end the resize).
const startResize = (nodeId: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const n = nodeById.get(nodeId);
    if (!n) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    resizeRef.current = {
      nodeId,
      startX: e.clientX - rect.left + canvas.scrollLeft,
      startY: e.clientY - rect.top + canvas.scrollTop,
      ow: n.width,
    };
  };

  const onResizeMove = (e: React.PointerEvent) => {
    const c = canvasRef.current;
    if (!c || !resizeRef.current) return;
    const cr = c.getBoundingClientRect();
    const cx = e.clientX - cr.left + c.scrollLeft;
    const cy = e.clientY - cr.top + c.scrollTop;
    const r = resizeRef.current;
    const src = nodeById.get(r.nodeId);
    if (!src) return;
    const vp = viewportFor(src);
    // Both axes drive the width so a diagonal corner drag feels smooth (the
    // height is derived from the ratio, so treat the vertical delta through
    // the ratio as an equivalent width delta).
    const dw = Math.max(cx - r.startX, (cy - r.startY) * (vp.w / vp.h));
    const w = Math.max(240, Math.min(2000, r.ow + dw));
    setNodes((prev) =>
      prev.map((nn) =>
        nn.id === r.nodeId
          ? { ...nn, width: w, height: Math.max(135, aspectH(w, nn.data?.ratio)) }
          : nn
      )
    );
  };

  const endResize = (e?: React.PointerEvent) => {
    if (e && e.currentTarget !== null) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {}
    }
    resizeRef.current = null;
  };

  // Wire a button to a page ("String" action): button → page connection, created
  // by clicking the button-dot ghost string onto a page's left input.
  const completeButtonString = (fromNodeId: string, selector: string, toNodeId: string) => {
    if (!fromNodeId || !selector || !toNodeId || fromNodeId === toNodeId) return;
    addLinkConnection(fromNodeId, selector, toNodeId);
    cancelStringing();
  };

  // Right-click canvas → "New Page": imports an HTML page as a SEPARATE panel,
  // placed to the right of the starting page. It is NOT auto-connected — wire
  // a button to it via the "String" action and attach its left input.
  const handleContextNewPage = () => {
    const start = entryNode || nodes.find((n) => n.type === "preview");
    const def = NODE_DEFAULTS.new_page;
    const id = uid("np");
    const x = start
      ? Math.min(CANVAS_W - def.width - 60, start.x + start.width + 260)
      : Math.max(40, contextMenu?.x ?? 500 - def.width / 2);
    const y = start
      ? Math.max(20, start.y + (start.height - def.height) / 2)
      : Math.max(20, (contextMenu?.y ?? 500) - def.height / 2);
    setNodes((prev) => [
      ...prev,
      {
        id,
        type: "new_page",
        x,
        y,
        width: def.width,
        height: def.height,
        data: { label: "New Page", buttonStates: {} },
      },
    ]);
    setSelectedId(id);
    setContextMenu(null);
    uploadNodeRef.current = id;
    requestAnimationFrame(() => {
      const el = canvasRef.current;
      if (el) {
        el.scrollLeft = Math.max(0, x - el.clientWidth / 2) + def.width / 2;
        el.scrollTop = Math.max(0, y - el.clientHeight / 2) + def.height / 2;
      }
      fileInputRef.current?.click();
    });
  };

  // Right-click canvas → "Note": a small free-size sticky panel to keep notes
  // per page/flow. Notes are plain canvas boxes — no strings or connectors.
  const handleContextAddNote = () => {
    const def = NODE_DEFAULTS.note;
    const id = uid("note");
    const x = Math.max(20, Math.min((contextMenu?.x ?? 500) - def.width / 2, CANVAS_W - def.width - 40));
    const y = Math.max(20, Math.min((contextMenu?.y ?? 500) - def.height / 2, CANVAS_H - def.height - 40));
    setNodes((prev) => [
      ...prev,
      { id, type: "note" as NodeType, x, y, width: def.width, height: def.height, data: { label: "Note", notes: "" } },
    ]);
    setSelectedId(id);
    setContextMenu(null);
  };

  // ── Node actions ──
  const addNode = (sourceId: string, action: ActionId, sourceSelector?: string) => {
    const source = nodeById.get(sourceId);
    if (!source) return;
    const def = NODE_DEFAULTS[nodeTypeOfAction(action)];
    const siblings = nodes.filter((n) => {
      return connections.some((c) => c.sourceNodeId === sourceId && c.targetNodeId === n.id);
    }).length;
    const x = source.x + source.width + 160;
    const y = source.y - 40 + siblings * 130;
    const id = uid("act");
    const newNode: FlowNode = {
      id,
      type: nodeTypeOfAction(action),
      x: Math.min(x, CANVAS_W - def.width - 40),
      y: Math.max(20, Math.min(y, CANVAS_H - def.height - 40)),
      width: def.width,
      height: def.height,
      data: {},
    };
    if (action === "url") {
      newNode.data = { label: "Custom link", url: "https://example.com" };
    }
    if (action === "new_page") {
      newNode.data = { label: "New Page" };
    }
    setNodes((prev) => [...prev, newNode]);
    setConnections((prev) => [
      ...prev,
      {
        id: uid("c"),
        sourceNodeId: sourceId,
        sourceButtonSelector: sourceSelector || "",
        targetNodeId: id,
        label: sourceSelector ? undefined : undefined,
      },
    ]);
    setSelectedId(id);
  };

  // Wire a button to a page panel ("String" action): button → page connection.
  const addLinkConnection = (sourceId: string, selector: string, targetId: string) => {
    if (
      connections.some(
        (c) =>
          c.sourceNodeId === sourceId &&
          c.sourceButtonSelector === selector &&
          c.targetNodeId === targetId
      )
    ) {
      return;
    }
    setConnections((prev) => [
      ...prev,
      {
        id: uid("c"),
        sourceNodeId: sourceId,
        sourceButtonSelector: selector,
        targetNodeId: targetId,
        label: popup?.text,
      },
    ]);
  };

  const removeConnection = (id: string) => {
    setConnections((prev) => prev.filter((c) => c.id !== id));
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setConnections((prev) =>
      prev.filter((c) => c.sourceNodeId !== id && c.targetNodeId !== id)
    );
    buttonRectsRef.current.forEach((_v, key, m) => {
      if (key.startsWith(`${id}::`)) m.delete(key);
    });
    if (selectedId === id) setSelectedId(null);
    if (editingUrlNodeId === id) setEditingUrlNodeId(null);
  };

  const updateNodeData = (id: string, patch: Record<string, any>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  };

  // Toggle the panel ratio (16:9 ↔ 9:16); manual choice stops auto-detect.
  const toggleRatio = (id: string) => {
    const n = nodeById.get(id);
    if (!n) return;
    const next: Ratio = n.data?.ratio === "9:16" ? "16:9" : "9:16";
    setNodes((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              data: { ...p.data, ratio: next, ratioManual: true },
              height: Math.max(135, aspectH(p.width, next)),
            }
          : p
      )
    );
  };

  // ── URL editing ──
  const openUrlEditor = (n: FlowNode) => {
    setEditingUrlNodeId(n.id);
    setUrlDraft({ label: n.data?.label || "Custom link", url: n.data?.url || "" });
  };

  const saveUrl = () => {
    if (editingUrlNodeId) {
      const n = nodeById.get(editingUrlNodeId);
      if (n) {
        const label = urlDraft.label.trim() || urlDraft.url.replace(/^https?:\/\//, "").split("/")[0] || "Custom link";
        const url = urlDraft.url.trim() || "https://example.com";
        updateNodeData(n.id, { label, url });
      }
    }
    setEditingUrlNodeId(null);
  };

  // ── DF: hardcoded-text editing ──
  const saveDfEdit = () => {
    if (!dfEdit) return;
    markDf(dfEdit.nodeId, dfEdit.selector, "text", dfDraft);
    sendDfState(dfEdit.nodeId);
    const wired = dfConnections.some(
      (c) => c.targetNodeId === dfEdit.nodeId && c.targetSelector === dfEdit.selector
    );
    setDfEdit(null);
    setDfContext(null);
    showDfToast(wired ? "Text updated — wired elements use the typed value at runtime" : "Text updated");
  };

  const toggleDfMode = () => {
    setDfMode((m) => {
      const next = !m;
      if (!next) {
        // Leaving DF mode: drop any in-progress dev-tools state so hover boxes,
        // stringing and context menus don't linger into normal mode.
        setDfHover(null);
        setDfContext(null);
        setDfEdit(null);
        setDfStringing(null);
        setTempConn(null);
      }
      return next;
    });
  };

  // Push DF mode + marks into every page frame whenever they change. Retried a
  // few times so slow-loading frames that missed the first post still receive it.
  useEffect(() => {
    const frameIds = () =>
      Array.from(canvasRef.current?.querySelectorAll("iframe[data-ph-frame]") || []).map((f) => f.getAttribute("data-ph-frame"));
    const push = () => {
      frameIds().forEach((nodeId) => {
        if (nodeId) sendDfState(nodeId);
      });
    };
    push();
    const timers = [250, 700, 1500].map((ms) => setTimeout(push, ms));
    return () => timers.forEach(clearTimeout);
  }, [dfMode, nodes, sendDfState]);

  // ── New page upload ──
  const triggerUpload = (nodeId: string) => {
    uploadNodeRef.current = nodeId;
    fileInputRef.current?.click();
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadNodeRef.current) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const target = uploadNodeRef.current;
      if (target) {
        const html = String(ev.target?.result || "");
        updateNodeData(target, {
          htmlContent: html,
          label: file.name.replace(/\.html?$/i, "") || "New Page",
        });
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── New page site-folder bundling (multipart pick) ──
  const triggerBundle = (nodeId: string) => {
    uploadNodeRef.current = nodeId;
    bundleInputRef.current?.click();
  };

  const handleBundleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    const target = uploadNodeRef.current;
    if (!target || files.length === 0) return;
    setBundleBusy(true);
    try {
      const bundled = await bundleSiteFiles(files);
      if (bundled) {
        updateNodeData(target, { htmlContent: bundled.html, label: bundled.label });
      }
    } catch (err) {
      console.error("Failed to bundle site files", err);
    } finally {
      setBundleBusy(false);
    }
  };

  // Auto-detect portrait pages on load: switch the panel to 9:16 unless the
  // user manually chose a ratio.
  const handleAutoRatio = useCallback((nodeId: string, portrait: boolean) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const desired: Ratio = portrait ? "9:16" : "16:9";
        if (n.data?.ratioManual || n.data?.ratio === desired) return n;
        return {
          ...n,
          data: { ...n.data, ratio: desired },
          height: Math.max(135, aspectH(n.width, desired)),
        };
      })
    );
  }, []);

  // ── Save ──
  const centerCanvas = () => {
    const el = canvasRef.current;
    const anchor = entryNode || nodes.find((n) => n.type === "preview") || nodes[0];
    if (!el || !anchor) return;
    el.scrollLeft = Math.max(0, anchor.x - el.clientWidth / 2) + anchor.width / 2;
    el.scrollTop = Math.max(0, anchor.y - el.clientHeight / 2) + anchor.height / 2;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Persist measured button rects so connector placements survive reloads.
      const payloadNodes = nodes.map((n) => {
        if (n.type !== "preview" && n.type !== "new_page") return n;
        const buttons: Record<string, { x: number; y: number; w: number; h: number }> = {};
        buttonRectsRef.current.forEach((rect, key) => {
          const sep = key.indexOf("::");
          if (sep > 0 && key.slice(0, sep) === n.id) buttons[key.slice(sep + 2)] = rect;
        });
        const dfRects: Record<string, { x: number; y: number; w: number; h: number }> = {};
        dfRectsRef.current.forEach((rect, key) => {
          const sep = key.indexOf("::");
          if (sep > 0 && key.slice(0, sep) === n.id) dfRects[key.slice(sep + 2)] = rect;
        });
        return { ...n, data: { ...n.data, buttons, dfRects } };
      });
      await api.put(`/landing-pages/${page.id}/flow`, { nodes: payloadNodes, connections });
      setSavedFlash(true);
      setTimeout(() => {
        setSavedFlash(false);
        onSaved?.(nodes, connections);
      }, 1500);
    } catch (err) {
      console.error("Failed to save flow", err);
    } finally {
      setSaving(false);
    }
  };

  const toggleButtonLock = (pop: PopupState) => {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== pop.sourceNodeId) return n;
        const states: Record<string, string> = n.data?.buttonStates || {};
        const next = states[pop.selector] === "locked" ? "unlocked" : "locked";
        return { ...n, data: { ...n.data, buttonStates: { ...states, [pop.selector]: next } } };
      })
    );
  };

  const popupExisting = popup
    ? (buttonStateMap.get(`${popup.sourceNodeId}::${popup.selector}`) || [])
        .map((id) => nodeById.get(id)?.type || "")
        .filter(Boolean)
    : [];

  const popupLocked =
    popup && nodeById.get(popup.sourceNodeId)?.data?.buttonStates?.[popup.selector] === "locked";

  // ── Render connections ──
  const renderedConnections = connections.map((c) => {
    const src = nodeById.get(c.sourceNodeId);
    const tgt = nodeById.get(c.targetNodeId);
    if (!src || !tgt) return null;
    if (c.type === "df") return null; // DF pipes render in their own layer
    // Page-node (preview / new_page) outgoing lines are drawn ON TOP of the
    // page by each node's own overlay, so skip them in this base layer.
    if (src.type === "preview" || src.type === "new_page") return null;

    let sx: number, sy: number;
    let label = "";

    if (c.sourceButtonSelector) {
      const rect = buttonRectsRef.current.get(`${c.sourceNodeId}::${c.sourceButtonSelector}`) || { x: 240, y: 140, w: 120, h: 36 };
      const vp = viewportFor(src);
      const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
      sx = src.x + 4 + (rect.x + rect.w / 2) * scale;
      sy = src.y + TITLE_BAR_H + 4 + (rect.y + rect.h / 2) * scale;
      label = c.label || "";
    } else {
      const p = nodeRightConnector(src);
      sx = p.x;
      sy = p.y;
    }

    const tp = nodeLeftConnector(tgt);
    const color = connectionColorFor(tgt.type);

    const locked = src.data?.buttonStates?.[c.sourceButtonSelector] === "locked";
    const dash = locked ? "6 5" : "";

    return (
      <g key={c.id}>
        <path d={bezierPath(sx, sy, tp.x, tp.y)} fill="none" stroke={color} strokeWidth={2} strokeDasharray={dash} opacity={0.85} />
        <circle cx={tp.x} cy={tp.y} r={4} fill={color} />
        <circle cx={sx} cy={sy} r={4} fill={color} />
        {label && (
          <text x={(sx + tp.x) / 2} y={(sy + tp.y) / 2 - 8} fill="#a1a1aa" fontSize={11} textAnchor="middle" className="connect-label">
            {label}
          </text>
        )}
        {locked && c.sourceButtonSelector && (
          <g transform={`translate(${(sx + tp.x) / 2 - 7}, ${(sy + tp.y) / 2 + 8})`}>
            <rect width={14} height={14} rx={3} fill="#18181b" stroke="#ef4444" strokeWidth={1} />
            <text x={7} y={10.5} textAnchor="middle" fontSize={9} fill="#f87171">L</text>
          </g>
        )}
      </g>
    );
  });

  // ── DF connectors (input → element on another page), always visible ──
  const renderedDfConnections = dfConnections.map((c) => {
    const src = nodeById.get(c.sourceNodeId);
    const tgt = nodeById.get(c.targetNodeId);
    if (!src || !tgt) return null;
    const vpS = viewportFor(src);
    const scaleS = fillScaleFor(vpS, src.width - 8, src.height - TITLE_BAR_H - 8);
    const vpT = viewportFor(tgt);
    const scaleT = fillScaleFor(vpT, tgt.width - 8, tgt.height - TITLE_BAR_H - 8);
    const srcRect = dfRectsRef.current.get(`${src.id}::${c.sourceSelector}`) || { x: 0, y: 0, w: 20, h: 20 };
    const tgtRect = dfRectsRef.current.get(`${tgt.id}::${c.targetSelector}`) || { x: 0, y: 0, w: 20, h: 20 };
    const sAnchor = clampedConnectorAnchor(srcRect, src.width - 8, src.height - TITLE_BAR_H - 8, scaleS);
    const tAnchor = clampedConnectorAnchor(tgtRect, tgt.width - 8, tgt.height - TITLE_BAR_H - 8, scaleT);
    // +4 on Y: the preview content box starts TITLE_BAR_H + 4px (p-1 padding)
    // below the node top — matching this offset keeps the connector dots
    // perfectly centred on the marked element (same math as pointFor).
    const sx = src.x + sAnchor.sx;
    const sy = src.y + TITLE_BAR_H + 4 + sAnchor.sy;
    const tx = tgt.x + tAnchor.sx;
    const ty = tgt.y + TITLE_BAR_H + 4 + tAnchor.sy;
    return { key: c.id, c, sx, sy, tx, ty };
  }).filter(Boolean) as { key: string; c: FlowConnection; sx: number; sy: number; tx: number; ty: number }[];

  if (!loaded) {
    return (
      <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-red-500 animate-spin" />
      </div>
    );
  }

  const canvasStyle: React.CSSProperties = {
    backgroundImage: "radial-gradient(circle, #27272a 1px, transparent 1px)",
    backgroundSize: "24px 24px",
  };

  return (
    <div className="fixed inset-0 z-[500] bg-black/80 backdrop-blur-sm flex items-center justify-center p-5">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 12 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
        className="w-full h-full max-w-none max-h-none bg-zinc-950 border border-zinc-700/60 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-red-950/50 border border-red-900/40 rounded-lg flex items-center justify-center">
              <PenTool className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white leading-none">Visual Editor</h2>
              <p className="text-[11px] text-zinc-500 mt-1">{page.name || "Landing page"}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {savedFlash && (
              <span className="text-xs text-emerald-400 flex items-center gap-1.5 mr-1">
                <Check className="w-3.5 h-3.5" /> Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Save
            </button>
            <button
              onClick={toggleDfMode}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-colors border
                ${dfMode
                  ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-400"
                  : "bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border-zinc-800"}`}
              title="Dynamic Fetching: mark input fields as sources and hardcoded text as targets, then wire them across pages"
            >
              <Zap className="w-3.5 h-3.5" />
              {dfMode ? "DF active" : "Dynamic Fetching"}
            </button>
            <button
              onClick={centerCanvas}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
              title="Center the canvas on the starting page"
            >
              <Crosshair className="w-3.5 h-3.5" />
              Center
            </button>
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-semibold transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Close
            </button>
          </div>
        </div>

        {/* ── Canvas ── */}
        <div
          ref={canvasRef}
          className="flex-1 overflow-auto relative cursor-default no-scrollbar m-3 rounded-2xl border border-zinc-800/70 bg-zinc-950/40"
          onMouseMove={onCanvasMouseMove}
          onMouseUp={onCanvasMouseUp}
          onMouseLeave={endInteraction}
          onContextMenu={(e) => {
            if (dfStringing) {
              e.preventDefault();
              e.stopPropagation();
              cancelDfStringing();
              return;
            }
            if (stringing) {
              e.preventDefault();
              e.stopPropagation();
              cancelStringing();
              return;
            }
            const target = e.target as HTMLElement | null;
            if (target?.closest?.("[data-node]")) return;
            e.preventDefault();
            if (dfMode) {
              showDfToast("Dynamic Fetching: right-click an element inside a page preview to mark it", true);
              return;
            }
            const canvas = canvasRef.current;
            if (!canvas) return;
            const rect = canvas.getBoundingClientRect();
            setContextMenu({
              x: e.clientX - rect.left + canvas.scrollLeft,
              y: e.clientY - rect.top + canvas.scrollTop,
            });
            setPopup(null);
            setEditingUrlNodeId(null);
          }}
          onClick={() => { setSelectedId(null); setPopup(null); setEditingUrlNodeId(null); setContextMenu(null); setDfContext(null); cancelStringing(); cancelDfStringing(); }}
        >
          <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H, ...canvasStyle }}>
            {/* grid dot pattern */}
            <div className="absolute inset-0 pointer-events-none opacity-60" style={{
              backgroundImage: "radial-gradient(circle, rgba(82,82,91,0.55) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }} />

            {/* connections SVG */}
            <svg
              className="absolute inset-0 pointer-events-none"
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ zIndex: 1 }}
            >
              {renderedConnections}
            </svg>

            {/* nodes */}
            {nodes.map((n) => {
              const selected = selectedId === n.id;
              const leftConn = nodeLeftConnector(n);
              const buttonPageOutgoing = connections.filter(
                (c) =>
                  c.sourceNodeId === n.id &&
                  c.sourceButtonSelector &&
                  (() => {
                    const t = nodeById.get(c.targetNodeId);
                    return !!t && (t.type === "preview" || t.type === "new_page");
                  })()
              );

              return (
                <div
                  key={n.id}
                  data-node={n.id}
                  className={`absolute rounded-xl border bg-zinc-900/95 shadow-2xl transition-shadow
                    ${selected ? "border-red-500/70 ring-2 ring-red-500/20" : "border-zinc-700 hover:border-zinc-600"}`}
                  style={{ left: n.x, top: n.y, width: n.width, height: n.height, zIndex: selected ? 50 : 10 }}
                  onMouseDown={(e) => { e.stopPropagation(); setSelectedId(n.id); setPopup(null); setEditingUrlNodeId(null); setContextMenu(null); setDfContext(null); }}
                  onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                >
                  {/* ── Title bar ── */}
                  <div
                    className="flex items-center justify-between gap-2 pl-3 pr-2 rounded-t-xl cursor-move select-none"
                    style={{ height: TITLE_BAR_H, backgroundColor: n.type === "preview" ? "rgba(127,29,29,0.28)" : "rgba(24,24,27,1)" }}
                    onMouseDown={startNodeDrag(n.id)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {n.type === "preview" && <Play className="w-3 h-3 text-red-500 shrink-0" />}
                      {n.type === "note" && <StickyNote className="w-3 h-3 text-red-400 shrink-0" />}
                      {editingNoteId === n.id ? (
                        <input
                          value={noteLabelDraft}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setNoteLabelDraft(e.target.value)}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              updateNodeData(n.id, { label: noteLabelDraft.trim() || "Note" });
                              setEditingNoteId(null);
                            } else if (e.key === "Escape") {
                              setEditingNoteId(null);
                            }
                          }}
                          onBlur={() => {
                            updateNodeData(n.id, { label: noteLabelDraft.trim() || "Note" });
                            setEditingNoteId(null);
                          }}
                          className="max-w-[130px] bg-zinc-950 border border-red-900/60 rounded px-1.5 py-0.5 text-xs font-semibold text-zinc-100 focus:outline-none"
                        />
                      ) : (
                        <span className="text-xs font-semibold text-zinc-100 truncate">
                          {n.type === "preview"
                            ? (n.data?.label || "Starting Page")
                            : n.type === "new_page"
                              ? (n.data?.label || "New Page")
                              : n.type === "capture"
                                ? "Capture Details"
                                : n.type === "url"
                                  ? "URL"
                                  : n.type === "note"
                                    ? (n.data?.label || "Note")
                                    : "Do Nothing"}
                        </span>
                      )}
                      {n.type === "note" && editingNoteId !== n.id && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setNoteLabelDraft(n.data?.label || "Note");
                            setEditingNoteId(n.id);
                          }}
                          title="Rename this note"
                          className="p-0.5 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {entryNode?.id === n.id && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-950/70 border border-red-900/50 text-red-400 font-semibold uppercase tracking-wider leading-none">
                          start
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {(n.type === "preview" || n.type === "new_page") && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); toggleRatio(n.id); }}
                          className="px-1.5 py-0.5 rounded-md hover:bg-zinc-800 text-[9px] font-mono text-zinc-400 hover:text-white transition-colors border border-zinc-700/60"
                          title="Toggle panel aspect ratio (16:9 / 9:16)"
                        >
                          {n.data?.ratio === "9:16" ? "9:16" : "16:9"}
                        </button>
                      )}
                      {n.type === "new_page" && (
                        <button
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => { e.stopPropagation(); triggerBundle(n.id); }}
                          className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                          title="Select a page + its .css/.js/images/fonts — bundled into one self-contained page"
                          disabled={bundleBusy}
                        >
                          {bundleBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pointer className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      {n.type === "new_page" && (
                        <button
                          onClick={(e) => { e.stopPropagation(); triggerUpload(n.id); }}
                          className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                          title="Import HTML for this page"
                        >
                          <FileCode2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteNode(n.id); }}
                        className="p-1 rounded-md hover:bg-red-950/60 text-zinc-400 hover:text-red-500 transition-colors"
                        title="Delete node"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* ── Content ── */}
                  <div className="p-1" style={{ height: n.height - TITLE_BAR_H }}>
                    {n.type === "preview" && (
                      <div className="relative w-full h-full overflow-hidden rounded-lg bg-white">
                        <div className="absolute top-1.5 left-1.5 z-10 flex gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-zinc-950/80 text-[9px] text-zinc-300 font-mono backdrop-blur-sm pointer-events-none">
                            {dfMode ? "DF: right-click to mark inputs & text" : "click a button to wire an action"}
                          </span>
                        </div>
                        <FrameContent node={n} pageHtml={page.html_content} ratio={n.data?.ratio} onAutoRatio={handleAutoRatio} stringingActive={!!stringing} />
                      </div>
                    )}

                    {n.type === "new_page" && (
                      <div className="relative w-full h-full flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
                        {n.data?.htmlContent ? (
                          <FrameContent node={n} pageHtml={n.data.htmlContent} ratio={n.data?.ratio} onAutoRatio={handleAutoRatio} stringingActive={!!stringing} />
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); triggerUpload(n.id); }}
                            className="flex flex-col items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            <Upload className="w-5 h-5" />
                            <span className="text-[10px] font-medium">Import HTML</span>
                          </button>
                        )}
                      </div>
                    )}

                    {n.type === "capture" && (
                      <div className="w-full h-full flex items-center gap-3 px-4">
                        <div className="w-9 h-9 rounded-lg bg-red-950/50 border border-red-900/40 flex items-center justify-center shrink-0">
                          <Eye className="w-4 h-4 text-red-400" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold text-zinc-200">Capture Details</p>
                          <p className="text-[10px] text-zinc-500 leading-snug">
                            Credentials are captured silently.
                          </p>
                        </div>
                      </div>
                    )}

                    {n.type === "url" && (
                      <div className="w-full h-full flex items-center px-3" onClick={(e) => { e.stopPropagation(); openUrlEditor(n); }}>
                        <div className="w-8 h-8 rounded-lg bg-amber-950/40 border border-amber-900/40 flex items-center justify-center shrink-0 mr-3">
                          <Globe className="w-4 h-4 text-amber-400" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-amber-300 leading-tight truncate">
                            {n.data?.label || "Custom link"}
                          </p>
                          <p className="text-[9px] text-zinc-500 font-mono truncate mt-0.5">
                            {n.data?.url || "custom URL"}
                          </p>
                        </div>
                        <Pencil className="w-3 h-3 text-zinc-600 ml-2 shrink-0" />
                      </div>
                    )}

                    {n.type === "do_nothing" && (
                      <div className="w-full h-full flex items-center gap-3 px-4">
                        <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
                          <Minimize2 className="w-4 h-4 text-zinc-400" />
                        </div>
                        <div>
                          <p className="text-[11px] font-semibold text-zinc-300">Do Nothing</p>
                          <p className="text-[10px] text-zinc-500 leading-snug">Stays on the current page.</p>
                        </div>
                      </div>
                    )}

                    {n.type === "note" && (
                      <div className="relative w-full h-full flex flex-col rounded-lg overflow-hidden border border-red-950/50 bg-zinc-950">
                        <textarea
                          value={(n.data?.notes as string) || ""}
                          maxLength={NOTE_MAX_CHARS}
                          onChange={(e) => updateNodeData(n.id, { notes: e.target.value })}
                          placeholder="Write a note about a page, wiring or anything here…"
                          className="flex-1 w-full resize-none overflow-y-auto bg-transparent px-3 pt-6 pb-2 text-[12px] font-medium text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                        />
                        {/* char counter — sits just below the delete icon */}
                        <span className="absolute top-1 right-2 text-[9px] font-mono text-red-500/70 pointer-events-none">
                          {(n.data?.notes as string || "").length}/{NOTE_MAX_CHARS}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* ── Connector lines drawn ON TOP of the page preview ── */}
                  {(n.type === "preview" || n.type === "new_page") && (
                    <NodeConnectionsOverlay
                      node={n}
                      connections={connections}
                      nodeById={nodeById}
                      buttonRects={buttonRectsRef.current}
                    />
                  )}

                  {/* ── Dynamic Fetching marks (red highlights + source dots) ── */}
                  {dfMode && (n.type === "preview" || n.type === "new_page") && (
                    <DfMarksOverlay node={n} rects={dfRectsRef.current} />
                  )}

                  {/* ── DF connector dots on marked INPUT sources (DF mode only) ──
                      Only these dots throw a value string — clicking elsewhere on
                      the page does nothing. */}
                  {dfMode && (n.type === "preview" || n.type === "new_page") &&
                    Object.entries((n.data?.dfMarks as DfMarks | undefined) || {})
                      .filter(([, mk]) => mk?.kind === "input")
                      .map(([sel]) => {
                        const r = dfRectsRef.current.get(`${n.id}::${sel}`);
                        if (!r || (!r.w && !r.h)) return null;
                        const vp = viewportFor(n);
                        const scale = fillScaleFor(vp, n.width - 8, n.height - TITLE_BAR_H - 8);
                        const anchor = clampedConnectorAnchor(r, n.width - 8, n.height - TITLE_BAR_H - 8, scale);
                        return connectorDot({
                          dotKey: `dfsrc-${sel}`,
                          x: anchor.sx,
                          y: TITLE_BAR_H + 4 + anchor.sy,
                          color: "#eab308",
                          title: "Fetch source — click to throw a value string",
                          onMouseDown: (e) => {
                            e.stopPropagation();
                            const cx = n.x + anchor.sx;
                            const cy = n.y + TITLE_BAR_H + 4 + anchor.sy;
                            setDfStringing({ fromNodeId: n.id, selector: sel, x: cx, y: cy });
                            setTempConn({ sx: cx, sy: cy, tx: cx, ty: cy });
                            setDfContext(null);
                            setDfEdit(null);
                          },
                          onClick: (e) => e.stopPropagation(),
                          onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); },
                        });
                      })}

                  {/* ── Resize corner (keeps the panel's aspect ratio) ── */}
                  {(n.type === "preview" || n.type === "new_page" || n.type === "note") && (
                    <div
                      onPointerDown={startResize(n.id)}
                      onPointerMove={onResizeMove}
                      onPointerUp={endResize}
                      onLostPointerCapture={endResize}
                      title="Drag to resize (keeps 16:9)"
                      className="absolute bottom-0 right-[3px] w-[18px] h-[18px] cursor-nwse-resize z-30 flex items-center justify-center pb-0.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      <ArrowDownRight className="w-4 h-4" strokeWidth={3.5} />
                    </div>
                  )}

                  {/* ── Connector dots ── */}
                  {/* Left input connector on every node: clicking it while a
                      button string is active attaches the string. */}
                  {/* Notes are plain canvas boxes — no left string connector. */}
                  {n.type !== "note" && connectorDot({
                    x: 0,
                    y: leftConn.y - n.y,
                    color: "#3f3f46",
                    dotKey: `left-${n.id}`,
                    title: "Input — click to attach a string to this page",
                    onMouseDown: (e) => {
                      e.stopPropagation();
                      const st = stringing;
                      if (st && st.selector && st.fromNodeId !== n.id && n.type !== "note") {
                        completeButtonString(st.fromNodeId, st.selector, n.id);
                      }
                    },
                    onContextMenu: (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    },
                  })}

                  {/* While stringing, pin a violet dot exactly where the ghost string
                        originates (the button), so the string visibly starts
                        from the button itself. */}
                  {stringing && stringing.fromNodeId === n.id && (
                    <div
                      title="String source dot"
                      className="absolute w-3.5 h-3.5 rounded-full border-2 border-zinc-950 pointer-events-none z-20"
                      style={{
                        left: stringing.x - n.x,
                        top: stringing.y - n.y,
                        backgroundColor: "#8b5cf6",
                        transform: "translate(-50%,-50%)",
                      }}
                    />
                  )}

                  {/* While a DF value string is live, pin its yellow source dot so
                      the string visibly starts from the input's connector — the
                      ghost snaps back to just this dot when the cursor leaves. */}
                  {dfStringing && dfStringing.fromNodeId === n.id && (
                    <div
                      title="Value string source dot"
                      className="absolute w-3.5 h-3.5 rounded-full border-2 border-zinc-950 pointer-events-none z-20"
                      style={{
                        left: dfStringing.x - n.x,
                        top: dfStringing.y - n.y,
                        backgroundColor: "#eab308",
                        transform: "translate(-50%,-50%)",
                      }}
                    />
                  )}

                  {/* Delete affordance (midpoint X) for button → page strings only. */}
                  {buttonPageOutgoing.map((c) => {
                    const tgt = nodeById.get(c.targetNodeId);
                    if (!tgt) return null;
                    const vp = viewportFor(n);
                    const scale = fillScaleFor(vp, n.width - 8, n.height - TITLE_BAR_H - 8);
                    const rect = buttonRectsRef.current.get(`${n.id}::${c.sourceButtonSelector}`) || { x: 240, y: 140, w: 120, h: 36 };
                    const anchor = clampedConnectorAnchor(rect, n.width - 8, n.height - TITLE_BAR_H - 8, scale);
                    const sx = n.x + anchor.sx;
                    const sy = n.y + TITLE_BAR_H + anchor.sy;
                    const mx = (sx + nodeLeftConnector(tgt).x) / 2 - n.x;
                    const my = (sy + nodeLeftConnector(tgt).y) / 2 - n.y;
                    return (
                      <button
                        key={`del-${c.id}`}
                        onClick={(e) => { e.stopPropagation(); removeConnection(c.id); }}
                        className="absolute z-40 w-5 h-5 rounded-full bg-zinc-900 border border-zinc-700 text-zinc-500 hover:text-red-400 hover:border-red-800/70 flex items-center justify-center transition-colors"
                        style={{ left: mx, top: my, transform: "translate(-50%,-50%)" }}
                        title="Delete this connection"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    );
                  })}
                </div>
              );
            })}

            {/* DF connectors (yellow value pipes) rendered above everything else. */}
            {renderedDfConnections.length > 0 && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={CANVAS_W}
                height={CANVAS_H}
                style={{ zIndex: 55 }}
              >
                {renderedDfConnections.map((p) => (
                  <g key={p.key}>
                    <path d={bezierPath(p.sx, p.sy, p.tx, p.ty)} fill="none" stroke="#eab308" strokeWidth={2} opacity={0.95} />
                    <circle cx={p.tx} cy={p.ty} r={4} fill="#eab308" stroke="#18181b" strokeWidth={1} />
                    <circle cx={p.sx} cy={p.sy} r={4} fill="#eab308" stroke="#18181b" strokeWidth={1} />
                  </g>
                ))}
              </svg>
            )}

            {/* DF delete affordances at the line midpoints — only in DF mode,
                since DF wiring is locked in normal mode. */}
            {dfMode && renderedDfConnections.map((p) => {
              const mx = (p.sx + p.tx) / 2;
              const my = (p.sy + p.ty) / 2;
              return (
                <button
                  key={`dfdel-${p.key}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConnection(p.c.id);
                  }}
                  className="absolute z-[56] w-5 h-5 rounded-full bg-zinc-900 border border-amber-500/60 text-amber-400 hover:text-red-400 hover:border-red-800/70 flex items-center justify-center transition-colors"
                  style={{ left: mx, top: my, transform: "translate(-50%,-50%)" }}
                  title="Delete this Dynamic Fetching connection"
                >
                  <X className="w-3 h-3" />
                </button>
              );
            })}

            {/* Devtools-style hover highlight on DF-eligible elements (DF mode only) */}
            {dfMode && dfHover && (() => {
              const src = nodeById.get(dfHover.nodeId);
              if (!src || !dfHover.selector) return null;
              const vp = viewportFor(src);
              const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
              const hx = src.x + 4 + dfHover.rect.x * scale;
              const hy = src.y + TITLE_BAR_H + 4 + dfHover.rect.y * scale;
              const hw = dfHover.rect.w * scale;
              const hh = dfHover.rect.h * scale;
              return (
                <div className="absolute pointer-events-none z-[58]">
                  <div className="absolute border border-sky-400/70 rounded-[1px]" style={{ left: hx, top: hy, width: hw, height: hh }}>
                    <span className="absolute -top-3.5 left-0 bg-sky-500/90 text-zinc-950 text-[8px] font-mono px-1 rounded-[2px] truncate max-w-[300px] leading-[14px]">
                      {dfHover.selector} · {dfHover.kind}
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Ghost connection string rendered ABOVE all panels/pins. */}
            {tempConn && (
              <svg
                className="absolute inset-0 pointer-events-none"
                width={CANVAS_W}
                height={CANVAS_H}
                style={{ zIndex: 60 }}
              >
                <path
                  d={bezierPath(tempConn.sx, tempConn.sy, tempConn.tx, tempConn.ty)}
                  fill="none"
                  stroke={dfStringing ? "#eab308" : stringing ? "#8b5cf6" : "#ef4444"}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  opacity={0.9}
                />
              </svg>
            )}

            {/* ── Action popup ── */}
            <AnimatePresence>
              {popup && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.12 }}
                >
                  <ButtonActionPopup
                    popup={popup}
                    existingTypes={popupExisting}
                    locked={!!popupLocked}
                    onPick={(a) => {
                      if (a === "link") {
                        const src = nodeById.get(popup.sourceNodeId);
                        if (src) {
                          const vp = viewportFor(src);
                          const scale = fillScaleFor(vp, src.width - 8, src.height - TITLE_BAR_H - 8);
                          const rect = popup.rect || buttonRectsRef.current.get(`${src.id}::${popup.selector}`) || { x: 240, y: 140, w: 120, h: 36 };
                          const sx = src.x + 4 + (rect.x + rect.w / 2) * scale;
                          const sy = src.y + TITLE_BAR_H + 4 + (rect.y + rect.h / 2) * scale;
                          setStringing({ fromNodeId: src.id, selector: popup.selector, x: sx, y: sy });
                          setTempConn({ sx, sy, tx: sx, ty: sy });
                        }
                        setPopup(null);
                      } else {
                        addNode(popup.sourceNodeId, a, popup.selector);
                        setPopup(null);
                      }
                    }}
                    onToggleLock={() => toggleButtonLock(popup)}
                    onClose={() => setPopup(null)}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Right-click context menu ── */}
            {contextMenu && (
              <div
                className="absolute z-[320] w-48 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
                style={{
                  left: Math.max(8, Math.min(contextMenu.x, CANVAS_W - 210)),
                  top: Math.max(8, Math.min(contextMenu.y, CANVAS_H - 120)),
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2.5 border-b border-zinc-800">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Canvas
                  </p>
                </div>
                <div className="p-1.5">
                  <button
                    onClick={handleContextNewPage}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                  >
                    <FileCode2 className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-zinc-200">
                      New Page
                      <span className="block text-[9px] text-zinc-500 font-normal">Import HTML as a separate panel (string it to pages yourself)</span>
                    </span>
                  </button>
                  <button
                    onClick={handleContextAddNote}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                  >
                    <StickyNote className="w-3.5 h-3.5 text-red-400" />
                    <span className="text-xs font-medium text-zinc-200">
                      Note
                      <span className="block text-[9px] text-zinc-500 font-normal">Add a written note about a page, wiring or anything</span>
                    </span>
                  </button>
                </div>
              </div>
            )}

            {/* ── Stringing status hint ── */}
            {stringing && (
              <div
                className="fixed z-[340] left-1/2 bottom-8 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-950/80 border border-violet-800/60 text-[11px] text-violet-200 shadow-xl backdrop-blur-sm"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoveRight className="w-3 h-3" />
                Click a page's <span className="text-violet-100 font-semibold">left input</span> to attach the string — click anywhere to cancel
              </div>
            )}

            {/* ── DF stringing hint ── */}
            {dfStringing && (
              <div
                className="fixed z-[340] left-1/2 bottom-8 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-950/80 border border-amber-700/60 text-[11px] text-amber-100 shadow-xl backdrop-blur-sm"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Zap className="w-3 h-3" />
                Click a <span className="text-amber-50 font-semibold">text / input element on another page</span> to fetch the typed value into it
              </div>
            )}

            {/* ── DF element context menu ── */}
            {dfContext && (
              <div
                className="absolute z-[320] w-56 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
                style={{
                  left: Math.max(8, Math.min(dfContext.x, CANVAS_W - 230)),
                  top: Math.max(8, Math.min(dfContext.y, CANVAS_H - 170)),
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-300 uppercase tracking-wider">
                    <Zap className="w-3 h-3" /> Dynamic Fetching
                  </span>
                  <button onClick={() => setDfContext(null)} className="text-zinc-500 hover:text-white transition-colors shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="px-3 py-2 border-b border-zinc-800/60">
                  <p className="text-[10px] text-zinc-500 font-mono truncate">{dfContext.selector}</p>
                  <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                    {dfContext.kind === "input" ? "Input field" : "Text element"}
                  </p>
                </div>
                <div className="p-1.5 space-y-0.5">
                  {dfContext.kind === "input" ? (
                    dfContext.marked ? (
                      <>
                        <button
                          onClick={() => { setDfStringing({ fromNodeId: dfContext.nodeId, selector: dfContext.selector, x: dfContext.x, y: dfContext.y }); setTempConn({ sx: dfContext.x, sy: dfContext.y, tx: dfContext.x, ty: dfContext.y }); setDfContext(null); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                        >
                          <Zap className="w-3.5 h-3.5 text-amber-400" />
                          <span className="text-xs font-medium text-zinc-200">
                            Start string from this input
                            <span className="block text-[9px] text-zinc-500 font-normal">Click a text / input on another page</span>
                          </span>
                        </button>
                        <button
                          onClick={() => { unmarkDf(dfContext.nodeId, dfContext.selector); sendDfState(dfContext.nodeId); setDfContext(null); showDfToast("Input unmarked"); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-red-950/60 transition-colors text-left"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-xs font-medium text-zinc-200">Unmark input</span>
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { markDf(dfContext.nodeId, dfContext.selector, "input"); sendDfState(dfContext.nodeId); setDfContext(null); showDfToast("Input marked as a fetch source"); }}
                        className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-xs font-medium text-zinc-200">
                          Mark as Input field
                          <span className="block text-[9px] text-zinc-500 font-normal">Typed value can be fetched into other pages</span>
                        </span>
                      </button>
                    )
                  ) : (
                    <>
                      {dfContext.marked ? (
                        <>
                          <button
                            onClick={() => { setDfEdit({ nodeId: dfContext.nodeId, selector: dfContext.selector, kind: "text", value: dfMarksFor(dfContext.nodeId)[dfContext.selector]?.value ?? dfContext.text, x: dfContext.x, y: dfContext.y }); setDfDraft(dfMarksFor(dfContext.nodeId)[dfContext.selector]?.value ?? dfContext.text); setDfContext(null); }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                          >
                            <Pencil className="w-3.5 h-3.5 text-zinc-300" />
                            <span className="text-xs font-medium text-zinc-200">
                              Edit text
                              <span className="block text-[9px] text-zinc-500 font-normal">Change the hardcoded value shown here</span>
                            </span>
                          </button>
                          <button
                            onClick={() => { unmarkDf(dfContext.nodeId, dfContext.selector); sendDfState(dfContext.nodeId); setDfContext(null); showDfToast("Text element unmarked"); }}
                            className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-red-950/60 transition-colors text-left"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                            <span className="text-xs font-medium text-zinc-200">Unmark text</span>
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => { markDf(dfContext.nodeId, dfContext.selector, "text", dfContext.text || undefined); setDfEdit({ nodeId: dfContext.nodeId, selector: dfContext.selector, kind: "text", value: dfContext.text, x: dfContext.x, y: dfContext.y }); setDfDraft(dfContext.text); setDfContext(null); }}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-zinc-800 transition-colors text-left"
                        >
                          <Pencil className="w-3.5 h-3.5 text-zinc-300" />
                          <span className="text-xs font-medium text-zinc-200">
                            Mark as Text
                            <span className="block text-[9px] text-zinc-500 font-normal">Replace the hardcoded value at runtime</span>
                          </span>
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="px-3 py-2 border-t border-zinc-800">
                  <p className="text-[9px] text-zinc-500 leading-snug">
                    {dfContext.kind === "input"
                      ? "Sources are inputs (email / username / phone). Connect them to targets on other pages."
                      : "Wiring an input into this text replaces its hardcoded value at runtime."}
                  </p>
                </div>
              </div>
            )}

            {/* ── DF hardcoded-text edit popup ── */}
            {dfEdit && (
              <div
                className="absolute z-[330] w-72 bg-zinc-900 border border-amber-700/50 rounded-xl shadow-2xl overflow-hidden"
                style={{
                  left: Math.max(8, Math.min(dfEdit.x, CANVAS_W - 300)),
                  top: Math.max(8, Math.min(dfEdit.y, CANVAS_H - 160)),
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-3 py-2.5 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-semibold text-amber-300">Edit hardcoded text</span>
                  <button onClick={() => setDfEdit(null)} className="text-zinc-500 hover:text-white transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-3">
                  <p className="text-[10px] text-zinc-500 font-mono truncate mb-2">{dfEdit.selector}</p>
                  <input
                    value={dfDraft}
                    onChange={(e) => setDfDraft(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60"
                    placeholder="Default value shown before a fetch"
                    autoFocus
                  />
                  <p className="text-[9px] text-zinc-500 leading-snug mt-2">
                    Shown when no value is fetched. When an input on another page is wired here, the typed value wins at runtime.
                  </p>
                  <div className="flex gap-2 justify-end mt-3">
                    <button
                      onClick={() => setDfEdit(null)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveDfEdit}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-lg text-xs font-medium transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── DF toast ── */}
            {dfToast && (
              <div
                className={`fixed z-[380] left-1/2 top-6 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-medium shadow-xl backdrop-blur-sm
                  ${dfToast.error ? "bg-red-950/90 border border-red-700/60 text-red-200" : "bg-amber-950/90 border border-amber-600/60 text-amber-100"}`}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Zap className={`w-3 h-3 ${dfToast.error ? "text-red-400" : "text-amber-300"}`} />
                {dfToast.msg}
              </div>
            )}
          </div>
        </div>

{/* ── Footer hint bar ── */}
        <div className="flex items-center gap-4 px-6 py-2.5 border-t border-zinc-800 shrink-0 text-[11px] text-zinc-500">
          {dfMode ? (
            <>
              <span className="flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-400" /> DF mode: right-click an input to mark it a source, right-click text to mark it replaceable</span>
              <span className="flex items-center gap-1.5"><MoveRight className="w-3.5 h-3.5 text-amber-400" /> Click a marked input, then a text / input on another page to wire the fetch</span>
              <span className="flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5 text-zinc-400" /> Double-click marked text to edit its hardcoded value</span>
              <span className="ml-auto flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5 text-sky-400" /> Hover any text / input to inspect its selector (DF mode)</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5 text-red-500" /> Click a button in the page preview to wire an action</span>
              <span className="flex items-center gap-1.5"><MoveRight className="w-3.5 h-3.5 text-violet-500" /> Pick String, then click a page's left input to attach</span>
              <span className="flex items-center gap-1.5"><MousePointerClick className="w-3.5 h-3.5 text-zinc-500" /> Right-click the canvas to add a New Page or a Note</span>
              <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Dashed lines = locked buttons</span>
              <span className="ml-auto flex items-center gap-1.5"><Zap className="w-3.5 h-3.5 text-amber-500" /> Dynamic Fetching pipes typed values between pages</span>
            </>
          )}
        </div>

        {/* always-present hidden file inputs for new-page upload */}
        <input type="file" accept=".html,.htm" className="hidden" ref={fileInputRef} onChange={handleFile} />
        <input
          type="file"
          accept=".html,.htm,.css,.js,.mjs,.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.ico,.woff,.woff2,.ttf,.otf,.eot"
          multiple
          className="hidden"
          ref={bundleInputRef}
          onChange={handleBundleFiles}
        />
      </motion.div>

      {/* ── Centered URL edit modal (fixed, outside any transform) ── */}
      {editingUrlNodeId && (() => {
        const n = nodeById.get(editingUrlNodeId);
        if (!n || n.type !== "url") return null;
        return (
          <div
            className="absolute inset-0 z-[600] flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); setEditingUrlNodeId(null); }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="absolute inset-0 bg-black/50" />
            <div
              className="relative w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <p className="text-[12px] font-semibold text-zinc-200 mb-3">Edit URL</p>
              <label className="block text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Display name</label>
              <input
                value={urlDraft.label}
                onChange={(e) => setUrlDraft((d) => ({ ...d, label: e.target.value }))}
                className="w-full mb-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-red-500/60"
                placeholder="e.g. Account Recovery"
                autoFocus
              />
              <label className="block text-[9px] uppercase tracking-wider text-zinc-500 mb-1">URL</label>
              <input
                value={urlDraft.url}
                onChange={(e) => setUrlDraft((d) => ({ ...d, url: e.target.value }))}
                className="w-full mb-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-red-500/60"
                placeholder="https://example.com/path"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditingUrlNodeId(null)}
                  className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveUrl}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// FRAME CONTENT (iframe wrapper that injects the bridge)
// ────────────────────────────────────────────────────────────────

// Shallow-red highlight overlay for every element marked for Dynamic Fetching.
// Stays visible even when DF mode is off; inputs also get a solid yellow dot
// (the connector anchor). Coordinates are pixel positions inside the node's
// content area (below the title bar), like the button connector overlay.
function DfMarksOverlay({
  node,
  rects,
}: {
  node: FlowNode;
  rects: Map<string, { x: number; y: number; w: number; h: number }>;
}) {
  const top = TITLE_BAR_H + 4;
  const vp = viewportFor(node);
  const contentW = node.width - 8;
  const contentH = node.height - TITLE_BAR_H - 8;
  const scale = fillScaleFor(vp, contentW, contentH);
  const marks = (node.data?.dfMarks as DfMarks | undefined) || {};
  // Mark boxes are drawn at their TRUE element position and CLIPPED by the
  // panel (overflow hidden): when a scrollable page pushes an element out of
  // view the box slides seamlessly behind the header / panel edge and never
  // floats outside the panel. When the element scrolls back, the box re-aligns
  // perfectly with it (rects re-measure on scroll via the bridge announce).
  const els = Object.entries(marks)
    .map(([sel, mk]) => {
      const r = rects.get(`${node.id}::${sel}`);
      if (!r || (!r.w && !r.h)) return null;
      const w = Math.max(8, r.w * scale);
      const h = Math.max(6, r.h * scale);
      return { sel, mk, x: r.x * scale, y: r.y * scale, w, h };
    })
    .filter(Boolean) as { sel: string; mk: DfMark; x: number; y: number; w: number; h: number }[];

  return (
    <svg
      className="absolute pointer-events-none z-[12]"
      style={{ top, left: 4, width: contentW, height: contentH, overflow: "hidden" }}
      width={contentW}
      height={contentH}
    >
      {els.map((p) => (
        <g key={p.sel}>
          <rect
            x={p.x}
            y={p.y}
            width={p.w}
            height={p.h}
            fill="rgba(239,68,68,0.08)"
            stroke="rgba(239,68,68,0.75)"
            strokeWidth={0.5}
            strokeDasharray="2.5 2.5"
            rx={1.5}
          />
          {p.mk.kind === "input" && (
            <circle cx={p.x + p.w / 2} cy={p.y + p.h / 2} r={2.5} fill="#eab308" stroke="#18181b" strokeWidth={0.5} />
          )}
        </g>
      ))}
    </svg>
  );
}

// Overlay that draws a page node's outgoing connector lines ON TOP of the page
// preview, anchored exactly on the clicked button (fixed-viewport scaling). One
// line per connection — extends outside the node bounds instead of duplicating
// the base layer (which skips page-node sources).
function NodeConnectionsOverlay({
  node,
  connections,
  nodeById,
  buttonRects,
}: {
  node: FlowNode;
  connections: FlowConnection[];
  nodeById: Map<string, FlowNode>;
  buttonRects: Map<string, { x: number; y: number; w: number; h: number }>;
}) {
  const contentW = node.width - 8;
  const contentH = node.height - TITLE_BAR_H - 8;
  const top = TITLE_BAR_H + 4;
  const vp = viewportFor(node);
  const scale = fillScaleFor(vp, contentW, contentH);
  const defaultRect = { x: node.width / 2, y: contentH / 2, w: 120, h: 36 };

  const paths = connections
    .filter((c) => c.sourceNodeId === node.id && c.type !== "df")
    .map((c) => {
      const tgt = nodeById.get(c.targetNodeId);
      if (!tgt) return null;
      let sx: number;
      let sy: number;
      let color: string;
      let label = c.label || "";
      let locked = false;
      if (c.sourceButtonSelector) {
        const rect = buttonRects.get(`${node.id}::${c.sourceButtonSelector}`) || defaultRect;
        const anchor = clampedConnectorAnchor(rect, contentW, contentH, scale);
        sx = anchor.sx;
        sy = anchor.sy;
        color = connectionColorFor(tgt.type);
        locked = node.data?.buttonStates?.[c.sourceButtonSelector] === "locked";
        if (locked) label = label || "locked";
      } else {
        const p = nodeRightConnector(node);
        sx = p.x - node.x;
        sy = p.y - node.y - top;
        color = connectionColorFor(tgt.type);
      }
      const tx = tgt.x - node.x;
      const ty = tgt.y + tgt.height / 2 - top - node.y;
      return { key: `${c.id}`, sx, sy, tx, ty, color, label, locked };
    })
    .filter(Boolean) as {
    key: string;
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    color: string;
    label: string;
    locked: boolean;
  }[];

  return (
    <svg
      className="absolute left-0 pointer-events-none"
      style={{ top, width: node.width, height: node.height - TITLE_BAR_H, overflow: "visible" }}
      width={node.width}
      height={node.height - TITLE_BAR_H}
    >
      {paths.map((p) => (
        <g key={p.key}>
          <path
            d={bezierPath(p.sx, p.sy, p.tx, p.ty)}
            fill="none"
            stroke={p.color}
            strokeWidth={2}
            strokeDasharray={p.locked ? "6 5" : ""}
            opacity={0.9}
          />
          <circle cx={p.sx} cy={p.sy} r={4} fill={p.color} stroke="#18181b" strokeWidth={1} />
          <circle cx={p.tx} cy={p.ty} r={4} fill={p.color} />
          {p.label && (
            <text x={(p.sx + p.tx) / 2} y={(p.sy + p.ty) / 2 - 8} fill="#a1a1aa" fontSize={11} textAnchor="middle">
              {p.label}
            </text>
          )}
          {p.locked && (
            <g transform={`translate(${(p.sx + p.tx) / 2 - 7}, ${(p.sy + p.ty) / 2 + 8})`}>
              <rect width={14} height={14} rx={3} fill="#18181b" stroke="#ef4444" strokeWidth={1} />
              <text x={7} y={10.5} textAnchor="middle" fontSize={9} fill="#f87171">L</text>
            </g>
          )}
        </g>
      ))}
    </svg>
  );
}

function FrameContent({
  node,
  pageHtml,
  ratio,
  onAutoRatio,
  stringingActive,
}: {
  node: FlowNode;
  pageHtml: string;
  ratio?: string;
  onAutoRatio?: (nodeId: string, portrait: boolean) => void;
  stringingActive?: boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const contentW = node.width - 8;
  const contentH = node.height - TITLE_BAR_H - 8;
  const vp = viewportFor(node);
  const scale = fillScaleFor(vp, contentW, contentH);
  const html = useMemo(
    () => injectBridge(pageHtml, node.id, vp.w, vp.h),
    [pageHtml, node.id, vp.w, vp.h]
  );

  // Detect the page's natural orientation (portrait → 9:16) so mobile pages
  // auto-switch, unless the user manually picked a ratio.
  useEffect(() => {
    const detect = () => {
      try {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) return;
        const m = measureDocDimensions(doc);
        if (m.w <= 0 || m.h <= 0) return;
        const portrait = m.h > m.w * 1.05;
        if (portrait && ratio !== "9:16") onAutoRatio?.(node.id, true);
        else if (!portrait && ratio !== "16:9") onAutoRatio?.(node.id, false);
      } catch {}
    };
    const t1 = window.setTimeout(detect, 300);
    const t2 = window.setTimeout(detect, 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, ratio]);

  return (
    <iframe
      ref={iframeRef}
      title={node.type === "new_page" ? "new page preview" : "page preview"}
      srcDoc={html}
      sandbox="allow-same-origin allow-scripts"
      data-ph-frame={node.id}
      className="border-none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: vp.w,
        height: vp.h,
        flexShrink: 0,
        transform: `scale(${scale})`,
        transformOrigin: "left top",
        pointerEvents: stringingActive ? "none" : "auto",
      }}
    />
  );
}