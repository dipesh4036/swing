"use client";

import React, { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import DataTrustView from "@/components/data-trust/DataTrustView";

export default function DataTrustPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-text-secondary">Loading Data Trust...</span>
        </div>
      }
    >
      <DataTrustView />
    </Suspense>
  );
}
