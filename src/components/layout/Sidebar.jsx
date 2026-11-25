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
  Compass,
  Bookmark,
  Briefcase,
  Database,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Radio,
  LogOut,
} from "lucide-react";

import ThemeToggle from "@/components/shared/ThemeToggle";

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
      },
      {
        id: "sectors",
        name: "Industries",
        href: "/sectors",
        icon: Compass,
        active: true,
      },
      {
        id: "screener",
        name: "Screener",
        href: "/screener",
        icon: Layers,
        active: true,
      },
    ],
  },
];

export function Sidebar({ isMobileOpen, onMobileClose, onToggleMobile }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    } finally {
      window.location.href = "/login";
    }
  };

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
        className={`fixed top-0 bottom-0 left-0 z-40 bg-surface border-r border-border flex flex-col transition-all duration-150 select-none ${
          collapsed ? "w-16" : "w-60"
        } ${
          isMobileOpen
            ? "translate-x-0"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Brand / Logo Top Bar */}
        <div className="h-14 border-b border-border flex items-center justify-between px-3.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary text-white flex items-center justify-center font-bold text-sm tracking-wider shrink-0">
              SW
            </div>
            {!collapsed && (
              <div className="min-w-0 leading-tight">
                <div className="text-[13px] font-bold text-text tracking-tight truncate flex items-center gap-1.5 uppercase">
                  Swing Terminal
                </div>
              </div>
            )}
          </div>

          {/* Close button for mobile drawer */}
          <button
            type="button"
            onClick={onMobileClose}
            className="lg:hidden min-w-[36px] min-h-[36px] p-1.5 rounded-md text-text-secondary hover:text-text hover:bg-hover flex items-center justify-center transition-colors"
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Groups */}
        <div className="flex-1 overflow-y-auto px-2.5 py-4 space-y-5 no-scrollbar">
          {NAV_ITEMS.map((section) => (
            <div key={section.group} className="space-y-1">
              {!collapsed && (
                <div className="px-2 text-[10px] font-bold text-text-muted tracking-wider uppercase mb-1">
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
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium transition-colors duration-150 group relative ${
                      isCurrent
                        ? "bg-primary-subtle text-primary font-semibold"
                        : "text-text-secondary hover:text-text hover:bg-hover"
                    }`}
                  >
                    <Icon
                      size={17}
                      strokeWidth={isCurrent ? 2.25 : 1.75}
                      className={`shrink-0 ${
                        isCurrent
                          ? "text-primary"
                          : "text-text-secondary group-hover:text-text"
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

        {/* Bottom Theme Toggle, Collapse & Footer */}
        <div className="p-2 border-t border-border shrink-0 bg-bg/50 space-y-2">
          {/* Theme Toggle Button */}
          <div className="flex items-center justify-between px-1">
            {!collapsed && (
              <span className="text-xs text-text-secondary font-medium">Appearance</span>
            )}
            <ThemeToggle compact className="w-full justify-center" />
          </div>

          {/* Logout Button */}
          <button
            type="button"
            onClick={handleLogout}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-xs font-medium text-text-secondary hover:text-bearish hover:bg-bearish-bg transition-colors ${
              collapsed ? "justify-center" : ""
            }`}
            title="Log out"
          >
            <LogOut size={16} className="shrink-0" />
            {!collapsed && <span>Log out</span>}
          </button>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="hidden lg:flex w-full items-center justify-center p-2 rounded-md text-text-secondary hover:text-text hover:bg-hover transition-colors"
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

