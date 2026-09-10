import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class helper: conditional classes, with Tailwind conflicts resolved. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
