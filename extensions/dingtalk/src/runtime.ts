import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

const runtimeStore = createPluginRuntimeStore<PluginRuntime>(
  "Dingtalk runtime not initialized. Make sure the plugin is properly registered.",
);

export type { PluginRuntime } from "openclaw/plugin-sdk/runtime-store";

export const setDingtalkRuntime = runtimeStore.setRuntime;
export const getDingtalkRuntime = runtimeStore.getRuntime;

export function isDingtalkRuntimeInitialized(): boolean {
  return runtimeStore.tryGetRuntime() !== null;
}

export function clearDingtalkRuntime(): void {
  runtimeStore.clearRuntime();
}
