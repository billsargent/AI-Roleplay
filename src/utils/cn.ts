/**
 * ─── Tailwind Class Merge Utility ───
 *
 * Combines clsx (conditional class building) with tailwind-merge
 * (intelligent Tailwind class conflict resolution).
 *
 * This allows conditional class names like:
 *   cn("px-4 py-2", isActive && "bg-indigo-600", "px-6") // px-6 wins
 *
 * @param inputs - Any number of class values (strings, objects, arrays)
 * @returns A single merged className string
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
