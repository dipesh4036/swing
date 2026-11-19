"use client";

import React from "react";

export function SegmentedControl({
  options = [],
  value,
  onChange,
  size = "sm",
  className = "",
}) {
  const sizeClasses =
    {
      xs: "h-6 text-[10px] px-1.5 sm:px-2",
      sm: "h-7 text-[11px] px-2 sm:px-2.5",
      md: "h-8 text-xs px-2.5 sm:px-3",
    }[size] || "h-7 text-[11px] px-2 sm:px-2.5";

  return (
    <div
      className={`inline-flex items-center p-0.5 bg-bg-secondary border border-border rounded-md select-none max-w-full overflow-x-auto no-scrollbar shrink-0 ${className}`}
    >
      {options.map((opt) => {
        const id = opt.id ?? opt;
        const label = opt.label ?? opt;
        const isSelected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              if (onChange) onChange(id);
            }}
            className={`font-medium rounded-[4px] transition-colors duration-150 flex items-center justify-center cursor-pointer whitespace-nowrap shrink-0 ${sizeClasses} ${
              isSelected
                ? "bg-surface text-primary font-semibold border border-border"
                : "text-text-secondary hover:text-text hover:bg-bg-hover border border-transparent"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
