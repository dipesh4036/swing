"use client";

import React from "react";
import { Info } from "lucide-react";

export function PageContainer({ children, className = "" }) {
  return (
    <div className={`w-full max-w-[1680px] mx-auto px-3 sm:px-4 md:px-6 lg:px-8 py-3 sm:py-4 md:py-5 space-y-4 pb-12 min-w-0 ${className}`}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  info,
  action,
  className = "",
}) {
  return (
    <div
      className={`flex items-center justify-between pb-2 border-b border-border ${className}`}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[14px] font-semibold text-text tracking-tight">
          {title}
        </h2>
        {info && (
          <span
            className="text-text-secondary hover:text-text-secondary cursor-pointer transition-colors"
            title={info}
          >
            <Info size={14} />
          </span>
        )}
        {subtitle && (
          <span className="text-[12px] text-text-secondary ml-2 hidden sm:inline">
            {subtitle}
          </span>
        )}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}

export default PageContainer;
