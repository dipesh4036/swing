"use client";

import React from "react";
import { Info } from "lucide-react";
import IndexCard from "./IndexCard";

export function IndicesSection({ indices = [] }) {
  if (!indices || indices.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2.5 pt-2">
      {/* Header */}
      <div className="flex items-center gap-1.5 pb-1">
        <span className="text-xs font-bold text-text uppercase tracking-wider">
          Indices &amp; Macro
        </span>
        <span title="Benchmark indices and key macroeconomic rates">
          <Info size={13} className="text-text-muted cursor-pointer" />
        </span>
      </div>

      {/* Horizontal grid of indices */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {indices.map((idx) => (
          <IndexCard key={idx.id} item={idx} />
        ))}
      </div>
    </div>
  );
}

export default IndicesSection;
