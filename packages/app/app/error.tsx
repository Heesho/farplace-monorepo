"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <div className="text-center px-6">
        <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
        <p className="text-sm text-muted-foreground mb-4">
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          className="px-6 py-2 rounded-xl bg-white text-black text-sm font-semibold hover:bg-zinc-200 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
