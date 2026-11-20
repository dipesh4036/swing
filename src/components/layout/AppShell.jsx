"use client";

import React, { useState } from "react";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";
import ThemeToggle from "@/components/shared/ThemeToggle";

export function AppShell({ children }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-bg text-text antialiased flex w-full transition-colors duration-150">
      {/* ── Navigation Sidebar ───────────────────────────────────── */}
      <Sidebar
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        onToggleMobile={() => setIsMobileOpen(!isMobileOpen)}
      />

      {/* ── Main Content Area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-200 lg:pl-60">
        {/* Mobile Top Header with Hamburger Button & Theme Toggle */}
        <header className="lg:hidden h-14 bg-surface border-b border-border px-4 flex items-center justify-between sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="min-w-[40px] min-h-[40px] p-2 -ml-2 text-text-secondary hover:text-text hover:bg-hover rounded-md flex items-center justify-center cursor-pointer transition-colors"
              aria-label="Open navigation menu"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-primary text-white flex items-center justify-center font-bold text-xs tracking-wider">
                SW
              </div>
              <span className="text-xs font-bold text-text tracking-tight uppercase">
                Swing Terminal
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] text-bullish font-medium bg-bullish-bg px-2.5 py-1 rounded-md border border-bullish-border">
              <span className="w-1.5 h-1.5 rounded-full bg-bullish animate-pulse" />
              <span>Live Feed</span>
            </div>
            <ThemeToggle compact />
          </div>
        </header>

        {/* Content Body */}
        <main className="flex-1 min-w-0 w-full">
          {children}
        </main>
      </div>
    </div>
  );
}

export default AppShell;

