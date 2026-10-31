import { SparklesIcon } from "lucide-react";

export function AiWorkingIndicator() {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-primary/20 bg-card px-4 py-3.5 shadow-2xs">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <SparklesIcon className="size-4 motion-safe:animate-pulse" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">Working on your request</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Putting the details together for you.</p>
        </div>
        <span className="flex shrink-0 gap-1" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="nemesis-ai-working-dot size-1 rounded-full bg-primary" style={{ animationDelay: `${dot * 160}ms` }} />
          ))}
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-primary/5" aria-hidden="true">
        <span className="nemesis-ai-working-line block h-full w-1/3 rounded-full bg-primary/50" />
      </div>
    </div>
  );
}
