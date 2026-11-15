"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  TrendingUp,
  Landmark,
  Layers,
  Bookmark,
  Briefcase,
  Database,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Radio,
} from "lucide-react";

const NAV_ITEMS = [
  {
    group: "ANALYTICS",
    items: [
      {
        id: "breadth",
        name: "Market Breadth",
        href: "/",
        icon: Activity,
        active: true,
      }
    ],
  }
];

export function Sidebar({ isMobileOpen, onMobileClose, onToggleMobile }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <>
      {/* ── Mobile Backdrop ─────────────────────────────────────────── */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden transition-opacity"
          onClick={onMobileClose}
        />
      )}

      {/* ── Sidebar Element ─────────────────────────────────────────── */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 bg-white border-r border-[#E5EAF2] flex flex-col transition-all duration-200 select-none ${
          collapsed ? "w-16" : "w-60"
        } ${
          isMobileOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand / Logo Top Bar */}
        <div className="h-14 border-b border-[#E5EAF2] flex items-center justify-between px-3.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-[8px] bg-[#3478F6] text-white flex items-center justify-center font-bold text-sm tracking-wider shadow-xs shrink-0">
              SW
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-bold text-[#17233B] tracking-tight truncate flex items-center gap-1.5">
                  SWING TERMINAL
                </div>
                <div className="text-[10px] text-[#94A3B8] font-medium flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#16A878] inline-block animate-pulse" />
                  <span>SmartAPI Active</span>
                </div>
              </div>
            )}
          </div>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden p-1.5 rounded-[6px] text-[#64748B] hover:text-[#17233B] hover:bg-[#F1F5F9]"
            title="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Groups */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5 no-scrollbar">
          {NAV_ITEMS.map((section) => (
            <div key={section.group} className="space-y-1">
              {!collapsed && (
                <div className="px-2 text-[10px] font-bold text-[#94A3B8] tracking-wider uppercase mb-1">
                  {section.group}
                </div>
              )}
              {section.items.map((item) => {
                const Icon = item.icon;
                const isCurrent = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => {
                      if (onMobileClose) onMobileClose();
                    }}
                    title={collapsed ? item.name : undefined}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[6px] text-xs font-medium transition-all group relative ${
                      isCurrent
                        ? "bg-[#EFF6FF] text-[#3478F6] font-semibold"
                        : "text-[#64748B] hover:text-[#17233B] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <Icon
                      size={17}
                      strokeWidth={isCurrent ? 2.25 : 1.75}
                      className={`shrink-0 ${
                        isCurrent
                          ? "text-[#3478F6]"
                          : "text-[#64748B] group-hover:text-[#17233B]"
                      }`}
                    />
                    {!collapsed && (
                      <div className="flex items-center justify-between flex-1 min-w-0">
                        <span className="truncate">{item.name}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Bottom Collapse Toggle & System Health Footer */}
        <div className="p-2 border-t border-[#E5EAF2] shrink-0 bg-[#F8FAFC]/50 space-y-2">
          {!collapsed && (
            <div className="px-2 py-1.5 bg-white border border-[#E5EAF2] rounded-[6px] text-[10px] space-y-0.5">
              <div className="flex items-center justify-between text-[#64748B]">
                <span>Data Feed</span>
                <span className="text-[#16A878] font-semibold">Synced</span>
              </div>
              <div className="text-[9px] text-[#94A3B8] truncate">
                Angel One SmartAPI · NSE Cash
              </div>
            </div>
          )}

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex w-full items-center justify-center p-2 rounded-[6px] text-[#64748B] hover:text-[#17233B] hover:bg-[#F1F5F9] transition-colors"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : (
              <div className="flex items-center gap-2 text-xs font-medium w-full px-1">
                <ChevronLeft size={16} />
                <span>Collapse sidebar</span>
              </div>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;

