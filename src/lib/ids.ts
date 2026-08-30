import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const gen = customAlphabet(alphabet, 20);

/** Prefixed, url-safe, sortable-ish id. e.g. id("task") -> "task_k1n2..." */
export function id(prefix: string): string {
  return `${prefix}_${gen()}`;
}
