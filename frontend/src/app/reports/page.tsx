"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FileDown, ShieldAlert, Users, Target, CheckCircle2, Search } from "lucide-react";
import api from "@/lib/api";

export default function Reports() {
  const [captures, setCaptures] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await api.get("/captures/");
        setCaptures(res.data);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchData();
  }, []);

  // Compute Awareness Scores
  // Group by email, count interactions. 
  // Base score 100. -20 for opening, -30 for clicking, -50 for submitting data
  const userScores = new Map<string, { email: string; score: number; events: number }>();
  
  captures.forEach(cap => {
    const email = cap.email || "Unknown";
    if (!userScores.has(email)) {
      userScores.set(email, { email, score: 100, events: 0 });
    }
    const user = userScores.get(email)!;
    // In our simplified backend, we just have 'captures'. Let's say a capture = data submitted (-50)
    user.score = Math.max(0, user.score - 50);
    user.events += 1;
  });

  const allScores = Array.from(userScores.values());
  const filteredScores = allScores.filter(s => s.email.toLowerCase().includes(searchQuery.toLowerCase()));
  
  const averageScore = allScores.length > 0 
    ? Math.round(allScores.reduce((acc, curr) => acc + curr.score, 0) / allScores.length)
    : 100;

  const handleExport = () => {
    const all = Array.from(userScores.values()).sort((a, b) => a.score - b.score);
    const avg = allScores.length > 0 ? averageScore : 0;
    const atRisk = allScores.filter(s => s.score < 50).length;
    const secure = allScores.filter(s => s.score >= 80).length;
    const researcher = allScores.length;

    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
    const riskLabel = (score: number) =>
      score < 40 ? "Critical Risk" : score < 60 ? "High Risk" : score < 80 ? "Medium Risk" : "Low Risk";
    const bandColor = (score: number) =>
      score >= 80 ? "#16a34a" : score >= 60 ? "#d97706" : score >= 40 ? "#ea580c" : "#dc2626";

    const heatCells = all.length
      ? all.map(u => `
        <div style="background:${bandColor(u.score)};border-radius:6px;padding:10px 8px;text-align:center;color:#fff;font-size:11px;line-height:1.35;break-inside:avoid;">
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;">${esc(u.email)}</div>
          <div style="font-size:16px;font-weight:700;margin-top:2px;">${u.score}<span style="font-size:9px;opacity:.8;">/100</span></div>
        </div>`).join("")
      : '<div style="grid-column:1/-1;text-align:center;color:#6b7280;padding:24px 0;">No user data available.</div>';

    const tableRows = all.length
      ? all.map((u, i) => `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 12px;text-align:center;color:#6b7280;">${i + 1}</td>
          <td style="padding:10px 12px;font-weight:600;color:#111827;">${esc(u.email)}</td>
          <td style="padding:10px 12px;text-align:center;">${u.events}</td>
          <td style="padding:10px 12px;text-align:center;font-weight:700;color:${bandColor(u.score)};">${u.score}/100</td>
          <td style="padding:10px 12px;text-align:center;">
            <span style="display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;background:${bandColor(u.score)};">${riskLabel(u.score)}</span>
          </td>
        </tr>`).join("")
      : '<tr><td colspan="5" style="padding:24px;text-align:center;color:#6b7280;">No user data available.</td></tr>';

    const dateStr = new Date().toLocaleDateString(undefined, {
      year: "numeric", month: "long", day: "numeric",
    });
    const host = window.location.origin;

    const doc = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>PhishHunt Security Awareness Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, Helvetica, sans-serif; background: #f3f4f6; color: #111827; padding: 32px; }
  @media print { body { background: #fff; padding: 0; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .sheet { background: #fff; max-width: 820px; margin: 0 auto; padding: 48px 44px; box-shadow: 0 1px 8px rgba(0,0,0,.08); }
  .hdr { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 3px solid #dc2626; padding-bottom: 18px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand img { width: 42px; height: 42px; border-radius: 10px; }
  .brand b { font-size: 22px; letter-spacing: 1px; }
  .brand b span { color: #dc2626; }
  .brand small { display: block; color: #6b7280; font-size: 11px; letter-spacing: .5px; }
  .meta { text-align: right; font-size: 12px; color: #6b7280; line-height: 1.7; }
  h1 { font-size: 24px; margin: 26px 0 4px; }
  .sub { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 28px; }
  .stat { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px 18px; }
  .stat .lbl { font-size: 11px; letter-spacing: .8px; text-transform: uppercase; color: #6b7280; font-weight: 700; }
  .stat .val { font-size: 30px; font-weight: 800; margin-top: 6px; }
  .stat .val small { font-size: 13px; font-weight: 600; color: #9ca3af; }
  h2 { font-size: 16px; margin: 4px 0 12px; }
  h2 small { font-weight: 400; color: #6b7280; font-size: 12px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: #374151; margin-bottom: 10px; }
  .legend i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
  th { background: #f9fafb; color: #374151; text-transform: uppercase; font-size: 10px; letter-spacing: .6px; }
  th, td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
  .foot { margin-top: 26px; padding-top: 14px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; font-size: 11px; color: #9ca3af; }
  .bar { position: sticky; bottom: 0; text-align: center; padding: 14px; }
  .bar button { padding: 10px 26px; font-size: 14px; font-weight: 700; border: 0; border-radius: 8px; background: #dc2626; color: #fff; cursor: pointer; }
  @media print { .bar { display: none; } .sheet { box-shadow: none; } }
</style>
</head>
<body>
  <div class="sheet">
    <div class="hdr">
      <div class="brand">
        <img src="${host}/logo.png" alt="PhishHunt" />
        <div><b>PHISH<span>HUNT</span></b><small>ETHICAL SECURITY TESTING PLATFORM</small></div>
      </div>
      <div class="meta">
        Security Awareness Report<br />
        Generated ${dateStr}
      </div>
    </div>

    <h1>Organization Awareness Summary</h1>
    <p class="sub">Aggregate phishing-resistance scoring across ${researcher} tracked user${researcher === 1 ? "" : "s"}.</p>

    <div class="stats">
      <div class="stat">
        <div class="lbl">Org Average Score</div>
        <div class="val">${avg}<small>/100</small></div>
      </div>
      <div class="stat">
        <div class="lbl">At-Risk Users</div>
        <div class="val" style="color:#dc2626;">${atRisk}</div>
      </div>
      <div class="stat">
        <div class="lbl">Secure Users</div>
        <div class="val" style="color:#16a34a;">${secure}</div>
      </div>
    </div>

    <h2>Risk Heatmap <small>— every user, colored by awareness score</small></h2>
    <div class="legend">
      <span><i style="background:#16a34a;"></i>Secure (80+)</span>
      <span><i style="background:#d97706;"></i>Medium (60–79)</span>
      <span><i style="background:#ea580c;"></i>High (40–59)</span>
      <span><i style="background:#dc2626;"></i>Critical (&lt;40)</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;">
      ${heatCells}
    </div>

    <h2 style="margin-top:28px;">User Breakdown</h2>
    <table>
      <thead>
        <tr>
          <th style="padding:10px 12px;">#</th>
          <th>User / Email</th>
          <th>Captured Events</th>
          <th>Awareness Score</th>
          <th>Risk Profile</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>

    <div class="foot">
      <span>Generated by PhishHunt Security Platform</span>
      <span>${dateStr}</span>
    </div>
  </div>
  <div class="bar">
    <button onclick="window.print()">Save / Print Report</button>
  </div>
</body>
</html>`;

    const win = window.open("", "_blank", "width=920,height=1100");
    if (!win) return;
    win.document.open();
    win.document.write(doc);
    win.document.close();
    win.onload = () => {
      setTimeout(() => {
        win.focus();
        win.print();
      }, 400);
    };
  };

  return (
    <div className="p-8 pb-20 w-full max-w-7xl mx-auto space-y-8 h-full flex flex-col">
      <div className="flex justify-between items-end print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Awareness Reports</h1>
          <p className="text-zinc-400">Security awareness scoring and risk heatmap across all campaigns.</p>
        </div>
        
        <button 
          onClick={handleExport}
          className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
        >
          <FileDown className="w-4 h-4" />
          Export PDF
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col justify-between print:border-zinc-300"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-red-950/50 rounded-lg text-red-500 print:bg-red-100">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-zinc-300 print:text-black">Org Average Score</h3>
          </div>
          <div>
            <div className="text-5xl font-bold text-white print:text-black mb-2">{averageScore}<span className="text-2xl text-zinc-500">/100</span></div>
            <p className="text-sm text-zinc-500">Overall security awareness rating</p>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col justify-between print:border-zinc-300"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-blue-950/50 rounded-lg text-blue-500 print:bg-blue-100">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-zinc-300 print:text-black">At-Risk Users</h3>
          </div>
          <div>
            <div className="text-5xl font-bold text-white print:text-black mb-2">{allScores.filter(s => s.score < 50).length}</div>
            <p className="text-sm text-zinc-500">Users with score below 50</p>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 flex flex-col justify-between print:border-zinc-300"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 bg-emerald-950/50 rounded-lg text-emerald-500 print:bg-emerald-100">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-zinc-300 print:text-black">Secure Users</h3>
          </div>
          <div>
            <div className="text-5xl font-bold text-white print:text-black mb-2">{allScores.filter(s => s.score >= 80).length}</div>
            <p className="text-sm text-zinc-500">Users with score above 80</p>
          </div>
        </motion.div>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden print:border-zinc-300"
      >
        <div className="p-6 border-b border-zinc-800 print:border-zinc-300 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-white print:text-black">Risk Heatmap</h3>
          </div>
          
          <div className="relative w-full sm:w-64 print:hidden">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
            <input 
              type="text" 
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-white focus:ring-2 focus:ring-red-500/50 focus:outline-none"
            />
          </div>
        </div>
        
        <div className="overflow-y-auto overflow-x-auto max-h-[22rem]">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 z-10 text-xs text-zinc-400 uppercase bg-zinc-900 print:bg-zinc-100 print:text-zinc-800">
              <tr>
                <th className="px-6 py-4 font-medium">User / Email</th>
                <th className="px-6 py-4 font-medium">Captured Events</th>
                <th className="px-6 py-4 font-medium">Awareness Score</th>
                <th className="px-6 py-4 font-medium">Risk Profile</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-500">Loading data...</td></tr>
              ) : filteredScores.length > 0 ? (
                filteredScores.sort((a,b) => a.score - b.score).map((user, i) => {
                  let riskColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
                  let riskLabel = "Low Risk";
                  
                  if (user.score < 30) {
                    riskColor = "text-red-500 bg-red-500/10 border-red-500/20";
                    riskLabel = "Critical Risk";
                  } else if (user.score < 60) {
                    riskColor = "text-orange-500 bg-orange-500/10 border-orange-500/20";
                    riskLabel = "High Risk";
                  } else if (user.score < 80) {
                    riskColor = "text-yellow-500 bg-yellow-500/10 border-yellow-500/20";
                    riskLabel = "Medium Risk";
                  }

                  return (
                    <tr key={i} className="border-b border-zinc-800/50 print:border-zinc-200 hover:bg-zinc-900/50 transition-colors">
                      <td className="px-6 py-4 text-white print:text-black font-medium">{user.email}</td>
                      <td className="px-6 py-4 text-zinc-400 print:text-zinc-600">{user.events}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className={`font-bold ${user.score < 50 ? 'text-red-400' : user.score < 80 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                            {user.score}
                          </span>
                          <div className="w-full max-w-[100px] h-1.5 bg-zinc-800 rounded-full overflow-hidden print:bg-zinc-200">
                            <div 
                              className={`h-full ${user.score < 50 ? 'bg-red-500' : user.score < 80 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                              style={{ width: `${user.score}%` }}
                            ></div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${riskColor} print:border-none`}>
                          {riskLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                    No user data found.
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
