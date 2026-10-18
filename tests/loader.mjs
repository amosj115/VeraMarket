import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolvedPath = resolvePath(SRC_DIR, specifier.slice(2));
    return nextResolve(resolvedPath, context);
  }
  return nextResolve(specifier, context);
}
