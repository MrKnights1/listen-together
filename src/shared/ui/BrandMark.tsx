/**
 * The room's mark: two rings overlapping, two people hearing one song. The
 * same drawing as `app/brand/favicon.svg`. Decorative: the room's name is
 * always written beside it.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="12" cy="16" r="8.5" fill="none" stroke="#f5a524" strokeWidth="3" />
      <circle cx="20" cy="16" r="8.5" fill="none" stroke="#f2f3f5" strokeWidth="3" />
    </svg>
  );
}
