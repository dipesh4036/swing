"use client";

import React, { Suspense } from "react";
import { RefreshCw } from "lucide-react";
import SectorDashboard from "@/components/industry-strength/SectorDashboard";

export default function SectorsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
          <RefreshCw className="w-6 h-6 animate-spin text-primary" />
          <span className="text-sm text-text-muted">Loading Industries...</span>
        </div>
      }
    >
      <SectorDashboard />
    </Suspense>
  );
}
