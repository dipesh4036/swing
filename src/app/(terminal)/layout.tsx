import React from "react";

export default function TerminalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#17233B] antialiased w-full">
      {children}
    </div>
  );
}
