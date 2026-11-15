"use client";

import React, { useState } from "react";
import Sidebar from "./Sidebar";
import { Menu, Activity } from "lucide-react";

export function AppShell({ children }) {
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#17233B] antialiased flex w-full">
      {/* ── Navigation Sidebar ───────────────────────────────────── */}
      <Sidebar
        isMobileOpen={isMobileOpen}
        onMobileClose={() => setIsMobileOpen(false)}
        onToggleMobile={() => setIsMobileOpen(!isMobileOpen)}
      />

      {/* ── Main Content Area ────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 transition-all duration-200 lg:pl-60">
        {/* Mobile Top Header with Hamburger Button */}
        <header className="lg:hidden h-12 bg-white border-b border-[#E5EAF2] px-3.5 flex items-center justify-between sticky top-0 z-30 shrink-0">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setIsMobileOpen(true)}
              className="p-1.5 -ml-1 text-[#64748B] hover:text-[#17233B] hover:bg-[#F1F5F9] rounded-[6px]"
              title="Open menu"
            >
              <Menu size={19} />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-[4px] bg-[#3478F6] text-white flex items-center justify-center font-bold text-[10px]">
                SW
              </div>
              <span className="text-xs font-bold text-[#17233B] tracking-tight">
                SWING TERMINAL
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[10px] text-[#16A878] font-semibold bg-[#ECFDF5] px-2 py-0.5 rounded-[4px] border border-[#A7F3D0]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#16A878] animate-pulse" />
            <span>SmartAPI</span>
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

