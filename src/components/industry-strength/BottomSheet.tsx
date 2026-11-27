"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export default function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/45"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full lg:max-w-2xl max-h-[85vh] overflow-y-auto rounded-t-2xl lg:rounded-xl bg-surface border border-border shadow-xl transition-transform duration-150">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-border bg-surface">
          <h3 className="text-sm font-semibold text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="p-1 rounded-md text-text-secondary hover:text-text hover:bg-bg-secondary cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
