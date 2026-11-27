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
    <div className="min-h-screen bg-bg flex flex-col justify-center items-center px-4 py-12 select-none transition-colors duration-150">
      <div className="w-full max-w-[380px]">
        {/* Brand Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-lg bg-primary text-text-inverse flex items-center justify-center font-bold text-lg tracking-wider mb-3">
            SW
          </div>
          <h1 className="text-xl font-bold text-text tracking-tight">
            Swing Terminal
          </h1>
          <p className="text-xs text-text-secondary mt-1 font-medium">
            Institutional Equities Momentum Workbench
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-lg p-6">
          <h2 className="text-sm font-semibold text-text mb-1">
            Owner Sign In
          </h2>
          <p className="text-xs text-text-secondary mb-5">
            Enter your credentials to access the terminal.
          </p>

          {error && (
            <div className="mb-4 p-3 bg-bearish-bg border border-bearish-border rounded-md flex items-start gap-2.5 text-xs text-bearish">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold text-text mb-1.5"
              >
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
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
                  className="w-full pl-9 pr-3 py-2 text-xs text-text bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors placeholder:text-text-muted"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold text-text mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
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
                  className="w-full pl-9 pr-3 py-2 text-xs text-text bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-colors placeholder:text-text-muted"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-primary hover:bg-primary-hover disabled:bg-primary/70 text-text-inverse text-xs font-semibold rounded-md transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
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
        <div className="text-center mt-6 text-xs text-text-secondary">
          Protected terminal · Authorized access only
        </div>
      </div>
    </div>
  );
}
