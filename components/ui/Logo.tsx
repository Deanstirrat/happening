/**
 * happening. wordmark — "in" and the trailing period in brand red (#ff0000),
 * the rest in the inherited text color so it adapts to its surface.
 * Uses the brand font (Plus Jakarta Sans / font-headline).
 */
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-headline font-extrabold tracking-tight ${className}`}>
      happen<span className="text-primary">in</span>g<span className="text-primary">.</span>
    </span>
  );
}
