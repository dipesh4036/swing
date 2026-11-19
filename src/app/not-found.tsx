import Link from "next/link";

export default function RootNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <h2 className="text-2xl font-bold mb-2 text-text">Page Not Found</h2>
      <p className="text-sm mb-4 text-text-secondary">The requested page does not exist.</p>
      <Link
        href="/"
        className="px-3.5 py-2 bg-primary text-text-inverse font-semibold rounded-md text-xs hover:bg-primary-hover transition-colors"
      >
        Go to Dashboard
      </Link>
    </div>
  );
}

