"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  MousePointerClick,
  Database, Network, Activity, AlertTriangle,
  X, Globe, Monitor, Clock, User, Lock,
  Users, KeyRound, ChevronDown, ChevronRight
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from "recharts";
import api from "@/lib/api";
import MetricCard from "@/components/MetricCard";

interface TimelinePoint {
  day: string;
  clicked: number;
  submitted: number;
}

interface Capture {
  id: number;
  campaign_id: number | null;
  page_id?: number | null;
  page_name?: string | null;
  ip: string;
  email: string | null;
  password_captured: boolean;
  submitted_at: string;
  session_id: string;
  user_agent: string | null;
}

interface CaptureDetail extends Capture {
  password_hash: string | null;
  password?: string | null;
  raw?: Record<string, any>;
}

interface UserGroup {
  ip: string;
  email: string | null;
  count: number;
  lastSeen: string;
  pageNames: string[];
  captures: Capture[];
  passwordCapturedCount: number;
}

function DetailRow({
  label, icon: Icon, children, mono,
}: {
  label: string;
  icon: any;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-4 p-3 bg-zinc-900/60 rounded-xl border border-zinc-800/60">
      <div className="w-7 h-7 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
        <Icon className="w-3.5 h-3.5 text-zinc-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider mb-0.5">{label}</p>
        <div className={`text-sm text-zinc-200 break-all ${mono ? "font-mono text-xs" : ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}

function CaptureDetailPanel({ detail }: { detail: CaptureDetail }) {
  const password = detail.password ?? detail.raw?.password;
  return (
    <div className="space-y-3">
      <DetailRow label="Email / Username" icon={User}>
        {detail.email || detail.raw?.username || "—"}
      </DetailRow>

      <DetailRow label="Captured Password" icon={KeyRound} mono>
        {password ? (
          <span className="text-red-400 font-medium">{password}</span>
        ) : detail.password_captured ? (
          <span className="text-emerald-400">Entered (plaintext not transmitted)</span>
        ) : (
          <span className="text-zinc-500">No</span>
        )}
      </DetailRow>

      <DetailRow label="Password Captured" icon={Lock}>
        {detail.password_captured ? (
          <span className="text-emerald-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            Yes
          </span>
        ) : (
          <span className="text-zinc-500">No</span>
        )}
      </DetailRow>

      <DetailRow label="IP Address" icon={Globe} mono>
        {detail.ip || "—"}
      </DetailRow>

      <DetailRow label="Submitted At" icon={Clock}>
        {new Date(detail.submitted_at).toLocaleString()}
      </DetailRow>

      <DetailRow label="Session ID" icon={Monitor} mono>
        {detail.session_id}
      </DetailRow>

      <DetailRow label="User Agent" icon={Monitor} mono>
        {detail.user_agent || "—"}
      </DetailRow>

      <DetailRow label="Landing Page" icon={Database} mono>
        {detail.page_id ? (
          <a
            href={`/build/${detail.page_id}`}
            target="_blank"
            rel="noreferrer"
            className="text-red-400 hover:text-red-300 underline underline-offset-2"
          >
            {detail.page_name || `Page #${detail.page_id}`}
          </a>
        ) : (
          "—"
        )}
      </DetailRow>

      {detail.raw?.event && (
        <DetailRow label="Event Type" icon={Activity} mono>
          {detail.raw.event}
        </DetailRow>
      )}

      {detail.raw?.password_entered && (
        <DetailRow label="Password Flag" icon={Lock} mono>
          {detail.raw.password_entered}
        </DetailRow>
      )}
    </div>
  );
}

function UserDetailModal({ group, onClose }: { group: UserGroup; onClose: () => void }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<string, CaptureDetail>>({});
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const toggle = (capture: Capture) => {
    if (openId === capture.id) {
      setOpenId(null);
      return;
    }
    setOpenId(capture.id);
    if (!details[capture.id]) {
      setLoadingId(capture.id);
      api.get(`/captures/${capture.id}`)
        .then(res => setDetails(prev => ({ ...prev, [capture.id]: res.data })))
        .catch(console.error)
        .finally(() => setLoadingId(null));
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 16 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 bg-red-950/50 border border-red-900/30 rounded-lg flex items-center justify-center shrink-0">
                <Users className="w-4 h-4 text-red-400" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                  <span className="font-mono truncate">{group.ip}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 font-medium shrink-0">
                    {group.count} capture{group.count === 1 ? "" : "s"}
                  </span>
                </h3>
                <p className="text-xs text-zinc-500 truncate">
                  {group.email || "Unknown user"} · last seen {new Date(group.lastSeen).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body: list of that IP's submissions */}
          <div className="p-4 max-h-[70vh] overflow-y-auto space-y-2">
            {group.captures.map(capture => {
              const isOpen = openId === capture.id;
              const detail = details[capture.id];
              return (
                <div
                  key={capture.id}
                  className={`rounded-xl border transition-colors overflow-hidden
                    ${isOpen ? "border-red-900/40 bg-zinc-900/70" : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"}`}
                >
                  <button
                    onClick={() => toggle(capture)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="text-zinc-500 shrink-0">
                      {isOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </span>
                    <div className="w-7 h-7 bg-zinc-800 rounded-lg flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-zinc-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-200 truncate">{capture.email || "Unknown"}</p>
                      <p className="text-xs text-zinc-500">
                        {new Date(capture.submitted_at).toLocaleString()}
                        {capture.page_name ? ` · ${capture.page_name}` : ""}
                      </p>
                    </div>
                    {capture.password_captured ? (
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 rounded-full shrink-0">
                        Password
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full shrink-0">
                        No password
                      </span>
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 border-t border-zinc-800/60">
                      {loadingId === capture.id ? (
                        <div className="flex justify-center py-8">
                          <div className="w-6 h-6 border-2 border-red-900 border-t-red-500 rounded-full animate-spin" />
                        </div>
                      ) : detail ? (
                        <CaptureDetailPanel detail={detail} />
                      ) : (
                        <p className="text-center text-zinc-500 py-6 text-sm">
                          Failed to load capture details.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function groupByIp(captures: Capture[]): UserGroup[] {
  const map = new Map<string, UserGroup>();
  for (const c of captures) {
    let g = map.get(c.ip);
    if (!g) {
      g = {
        ip: c.ip,
        email: c.email,
        count: 0,
        lastSeen: c.submitted_at,
        pageNames: [],
        captures: [],
        passwordCapturedCount: 0,
      };
      map.set(c.ip, g);
    }
    g.captures.push(c);
    g.count += 1;
    if (c.password_captured) g.passwordCapturedCount += 1;
    if (c.page_name && !g.pageNames.includes(c.page_name)) g.pageNames.push(c.page_name);
    if ((!g.email || g.email === "Unknown" || g.email === null) && c.email) g.email = c.email;
  }
  return Array.from(map.values()).sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<any>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<UserGroup | null>(null);

  const fetchData = useCallback(async (initial = false) => {
    try {
      const [metricsRes, capturesRes, timelineRes] = await Promise.all([
        api.get("/campaigns/metrics"),
        api.get("/captures/"),
        api.get("/campaigns/timeline", { params: { days: 7 } })
      ]);
      setMetrics(metricsRes.data);
      setCaptures(capturesRes.data || []);
      setTimeline(timelineRes.data || []);
    } catch (error) {
      console.error("Failed to fetch dashboard data:", error);
    } finally {
      if (initial) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(true);
    // Real-time: poll for fresh clicks, submissions and captures.
    const interval = setInterval(() => fetchData(), 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const userGroups = groupByIp(captures);

  if (isLoading || !metrics) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-red-900 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  const timelineData = timeline.map(point => ({
    label: new Date(point.day).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    clicked: point.clicked,
    submitted: point.submitted,
  }));

  return (
    <div className="p-8 pb-20 w-full max-w-7xl mx-auto space-y-8">
      {selectedUser && (
        <UserDetailModal
          group={selectedUser}
          onClose={() => setSelectedUser(null)}
        />
      )}

      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Campaign Dashboard</h1>
          <p className="text-zinc-400">Overview of your ethical phishing campaigns and security metrics.</p>
        </div>
        <div className={`px-4 py-2 rounded-lg border flex items-center gap-2 font-medium
          ${metrics.risk_level === 'Critical' ? 'bg-red-950 border-red-900 text-red-500' :
            metrics.risk_level === 'High' ? 'bg-orange-950 border-orange-900 text-orange-500' :
            metrics.risk_level === 'Medium' ? 'bg-yellow-950 border-yellow-900 text-yellow-500' :
            'bg-emerald-950 border-emerald-900 text-emerald-500'}
        `}>
          <AlertTriangle className="w-5 h-5" />
          Risk Level: {metrics.risk_level}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <MetricCard title="Links Clicked"    value={metrics.links_clicked}    icon={<MousePointerClick />} description="Landing page opens" delay={0.1} />
        <MetricCard title="Data Submitted"   value={metrics.data_submitted}   icon={<Database />}          description={`${metrics.submission_rate}% Submission Rate`} delay={0.2} />
        <MetricCard title="IPs Observed"     value={metrics.ips_observed}     icon={<Network />}           delay={0.3} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-6"
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-zinc-400" />
            <h3 className="font-semibold text-white">Engagement Timeline</h3>
          </div>
          <p className="text-xs text-zinc-500">Daily link clicks &amp; credential submissions — live</p>
        </div>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timelineData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorClicked" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorSubmitted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#b91c1c" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#b91c1c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#52525b" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#52525b" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '8px' }} itemStyle={{ color: '#e4e4e7' }} />
              <Area type="monotone" dataKey="clicked" name="Links Clicked" stroke="#ef4444" fillOpacity={1} fill="url(#colorClicked)" />
              <Area type="monotone" dataKey="submitted" name="Data Submitted" stroke="#b91c1c" fillOpacity={1} fill="url(#colorSubmitted)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Captures grouped by IP — users list */}
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden"
      >
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-white">Recent Captures</h3>
          </div>
          <p className="text-xs text-zinc-500">
            Users grouped by IP — click a user to inspect everything the payload captured
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-zinc-400 uppercase bg-zinc-900/50">
              <tr>
                <th className="px-6 py-4 font-medium">User</th>
                <th className="px-6 py-4 font-medium">IP Address</th>
                <th className="px-6 py-4 font-medium">Captures</th>
                <th className="px-6 py-4 font-medium">Passwords</th>
                <th className="px-6 py-4 font-medium">Landing Page</th>
                <th className="px-6 py-4 font-medium">Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {userGroups.length > 0 ? userGroups.map((group, i) => (
                <tr
                  key={`${group.ip}-${i}`}
                  onClick={() => setSelectedUser(group)}
                  className="border-b border-zinc-800/50 hover:bg-zinc-900/70 transition-colors cursor-pointer group"
                >
                  <td className="px-6 py-4 text-white font-medium">{group.email || "Unknown"}</td>
                  <td className="px-6 py-4 font-mono text-xs text-zinc-400">{group.ip}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-full">
                      {group.count}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {group.passwordCapturedCount > 0 ? (
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-950/50 border border-emerald-900/50 text-emerald-400 rounded-full">
                        {group.passwordCapturedCount}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-[10px] font-semibold bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-full">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-zinc-400 max-w-[180px] truncate">
                    {group.pageNames[0] || "—"}
                  </td>
                  <td className="px-6 py-4 text-zinc-500">
                    {new Date(group.lastSeen).toLocaleString()}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                    No captures recorded yet. Share a landing page (
                    <span className="font-mono text-zinc-400">/build/:id</span>)
                    and submit the form to verify the payload.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}