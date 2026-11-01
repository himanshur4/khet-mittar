// Runs once when the Next.js server boots: validates env and reports disabled features.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logConfigReport } = await import("@/core/lib/env");
  logConfigReport();
}
