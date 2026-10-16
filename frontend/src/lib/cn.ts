import { twMerge } from 'tailwind-merge';

type ClassValue = string | number | false | null | undefined;

// Joins conditional classes and resolves Tailwind conflicts, so a caller's
// override actually wins (`<Button className="bg-red-600">` beats the
// variant's own background instead of depending on stylesheet order).
//
// The conditional-join half is small enough to own outright; twMerge does the
// part that genuinely needs a model of Tailwind's class groups.
export function cn(...inputs: (ClassValue | ClassValue[])[]): string {
  const classes: string[] = [];

  for (const input of inputs) {
    if (Array.isArray(input)) {
      for (const nested of input) {
        if (typeof nested === 'string' && nested.length > 0) classes.push(nested);
      }
    } else if (typeof input === 'string' && input.length > 0) {
      classes.push(input);
    }
  }

  return twMerge(classes.join(' '));
}
