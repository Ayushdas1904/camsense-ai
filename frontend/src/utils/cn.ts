/**
 * Tiny className combiner — joins truthy class strings and drops falsy ones.
 * Keeps conditional Tailwind classes readable without a heavy dependency.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
