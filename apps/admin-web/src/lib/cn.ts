/** Tiny classname joiner — avoids pulling in clsx for this small a need. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
