"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  User, KeyRound, ShieldCheck, Save, CheckCircle2, AlertCircle, Eye, EyeOff
} from "lucide-react";
import api from "@/lib/api";

const PasswordInput = ({
  value, onChange, show, onToggle, placeholder, id
}: {
  value: string; onChange: (v: string) => void;
  show: boolean; onToggle: () => void;
  placeholder: string; id: string;
}) => (
  <div className="relative">
    <input
      id={id}
      type={show ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 pr-11 bg-zinc-900/50 border border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 text-white transition-all placeholder:text-zinc-600"
      required
    />
    <button
      type="button"
      onClick={onToggle}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
    >
      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  </div>
);

const FeedbackBanner = ({ msg }: { msg: { type: "success" | "error"; text: string } | null }) => {
  if (!msg) return null;
  const isSuccess = msg.type === "success";
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm
        ${isSuccess
          ? "bg-emerald-950/50 border border-emerald-900/50 text-emerald-400"
          : "bg-red-950/50 border border-red-900/50 text-red-400"
        }`}
    >
      {isSuccess ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
      {msg.text}
    </motion.div>
  );
};

export default function Settings() {
  const router = useRouter();

  // Username state
  const [username, setUsername] = useState("");
  const [originalUsername, setOriginalUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameMsg, setUsernameMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch current user
  useEffect(() => {
    api.get("/auth/me")
      .then(res => {
        setUsername(res.data.username);
        setOriginalUsername(res.data.username);
      })
      .catch(() => router.push("/login"));
  }, [router]);

  const handleUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || username === originalUsername) return;
    setUsernameLoading(true);
    setUsernameMsg(null);
    try {
      const res = await api.put("/auth/me", { new_username: username.trim() });
      setUsername(res.data.username);
      setOriginalUsername(res.data.username);
      setUsernameMsg({ type: "success", text: "Username updated successfully!" });
    } catch (err: any) {
      setUsernameMsg({ type: "error", text: err.response?.data?.detail || "Failed to update username" });
    } finally {
      setUsernameLoading(false);
      setTimeout(() => setUsernameMsg(null), 4000);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords do not match" });
      return;
    }
    if (newPassword.length <= 4) {
      setPasswordMsg({ type: "error", text: "Password must be more than 4 characters" });
      return;
    }

    setPasswordLoading(true);
    try {
      await api.post("/auth/change-password", {
        current_password: currentPassword,
        new_password: newPassword,
      });
      setPasswordMsg({ type: "success", text: "Password updated successfully!" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: any) {
      setPasswordMsg({ type: "error", text: err.response?.data?.detail || "Failed to update password" });
    } finally {
      setPasswordLoading(false);
      setTimeout(() => setPasswordMsg(null), 5000);
    }
  };

  return (
    <div className="p-8 w-full max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Settings</h1>
        <p className="text-zinc-400">Manage your account preferences and security settings.</p>
      </div>

      {/* Account Section */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-950/50 border border-blue-900/30 rounded-lg flex items-center justify-center">
            <User className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Account</h2>
            <p className="text-xs text-zinc-500">Update your username</p>
          </div>
        </div>

        <form onSubmit={handleUsernameChange} className="p-6 space-y-4">
          <FeedbackBanner msg={usernameMsg} />

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full px-4 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/50 focus:border-red-500 text-white transition-all placeholder:text-zinc-600"
              required
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={usernameLoading || !username.trim() || username === originalUsername}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium flex items-center gap-2 transition-all text-sm"
            >
              {usernameLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save Username
            </button>
          </div>
        </form>
      </motion.div>

      {/* Security Section */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-zinc-800 flex items-center gap-3">
          <div className="w-9 h-9 bg-red-950/50 border border-red-900/30 rounded-lg flex items-center justify-center">
            <KeyRound className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h2 className="font-semibold text-white">Security</h2>
            <p className="text-xs text-zinc-500">Change your password</p>
          </div>
        </div>

        <form onSubmit={handlePasswordChange} className="p-6 space-y-4">
          <FeedbackBanner msg={passwordMsg} />

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5" htmlFor="current-pw">
              Current Password
            </label>
            <PasswordInput
              id="current-pw"
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrentPw}
              onToggle={() => setShowCurrentPw(v => !v)}
              placeholder="Enter current password"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5" htmlFor="new-pw">
              New Password
            </label>
            <PasswordInput
              id="new-pw"
              value={newPassword}
              onChange={setNewPassword}
              show={showNewPw}
              onToggle={() => setShowNewPw(v => !v)}
              placeholder="Enter new password"
            />
            <p className="text-xs text-zinc-600 mt-1.5">Must be more than 4 characters.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1.5" htmlFor="confirm-pw">
              Confirm New Password
            </label>
            <PasswordInput
              id="confirm-pw"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showConfirmPw}
              onToggle={() => setShowConfirmPw(v => !v)}
              placeholder="Confirm new password"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={passwordLoading || !currentPassword || !newPassword || !confirmPassword}
              className="px-6 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium flex items-center gap-2 transition-all text-sm"
            >
              {passwordLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              Update Password
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
