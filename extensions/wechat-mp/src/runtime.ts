import type { PluginRuntime } from "./types.js";

let runtime: PluginRuntime | null = null;

/**
 * Set the WeChat MP plugin runtime.
 * Called during plugin registration to inject host runtime capabilities.
 */
export function setWechatMpRuntime(next: PluginRuntime): void {
  runtime = next;
}

/**
 * Get the WeChat MP plugin runtime.
 * Throws if runtime is not initialized.
 */
export function getWechatMpRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("WeChat MP runtime not initialized.");
  }
  return runtime;
}

/**
 * Try to get the WeChat MP plugin runtime.
 * Returns null if not initialized instead of throwing.
 */
export function tryGetWechatMpRuntime(): PluginRuntime | null {
  return runtime;
}

/**
 * Clear the WeChat MP plugin runtime.
 * Used for cleanup and testing.
 */
export function clearWechatMpRuntime(): void {
  runtime = null;
}
