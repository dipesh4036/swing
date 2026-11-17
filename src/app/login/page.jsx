"use client";

import React, { useState } from "react";
import { Lock, Mail, AlertCircle, ArrowRight, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) {
          setError(data.error || "Too many failed attempts. Please try again in 15 minutes.");
        } else {
          setError(data.error || "Invalid email or password");
        }
        setLoading(false);
        return;
      }

      // Successful login - redirect to root
      window.location.href = "/";
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center px-4 py-12 select-none">
      <div className="w-full max-w-[380px]">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-[12px] bg-[#2563EB] text-white flex items-center justify-center font-bold text-lg tracking-wider shadow-sm mb-3">
            SW
          </div>
          <h1 className="text-xl font-bold text-[#17233B] tracking-tight">
            Swing Terminal
          </h1>
          <p className="text-xs text-[#64748B] mt-1 font-medium">
            Institutional Equities Momentum Workbench
          </p>
        </div>

        {/* Card */}
        <div className="bg-white border border-[#E5EAF2] rounded-[10px] shadow-xs p-6">
          <h2 className="text-sm font-semibold text-[#17233B] mb-1">
            Owner Sign In
          </h2>
          <p className="text-xs text-[#94A3B8] mb-5">
            Enter your credentials to access the terminal.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-[#FEF0F4] border border-[#FCCEDB] rounded-[6px] flex items-start gap-2.5 text-xs text-[#BE185D]">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-[#17233B] mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                  <Mail size={15} />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full pl-9 pr-3 py-2 text-xs text-[#17233B] bg-white border border-[#CBD5E1] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors placeholder:text-[#94A3B8]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-[#17233B] mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#94A3B8]">
                  <Lock size={15} />
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 text-xs text-[#17233B] bg-white border border-[#CBD5E1] rounded-[6px] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors placeholder:text-[#94A3B8]"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:bg-[#2563EB]/70 text-white text-xs font-semibold rounded-[6px] transition-colors flex items-center justify-center gap-2 shadow-xs cursor-pointer disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={14} />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <div className="text-center mt-6 text-[11px] text-[#94A3B8]">
          Protected terminal · Authorized access only
        </div>
      </div>
    </div>
  );
}
