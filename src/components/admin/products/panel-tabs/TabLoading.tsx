/**
 * Shared loading state for lazily-fetched panel tabs (custom fields,
 * related, SEO). Mirrors the panel's spinner idiom.
 */
export default function TabLoading() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="inline-block w-3 h-3 rounded-full border-2 border-foreground/30 border-t-foreground/70 animate-spin"
          aria-hidden
        />
        Φόρτωση…
      </div>
    </div>
  );
}
