import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw-china/shared", async () => {
  const actual = await vi.importActual<typeof import("@openclaw-china/shared")>(
    "@openclaw-china/shared",
  );
  return {
    ...actual,
    registerChinaSetupCli: vi.fn(),
    showChinaInstallHint: vi.fn(),
  };
});

import entry from "../index.js";
import setupEntry, { wecomAppSetupPlugin } from "../setup-entry.js";
import { wecomAppPlugin } from "./channel.js";
import { clearWecomAppRuntime, getWecomAppRuntime } from "./runtime.js";

function registerWecomAppPlugin(config?: {
  webhookPath?: string;
  accounts?: Record<string, { webhookPath?: string }>;
}): string[] {
  const routes: string[] = [];

  entry.register({
    registerChannel: () => {},
    runtime: {},
    registerHttpRoute: (params: { path: string }) => {
      routes.push(params.path);
    },
    config: {
      channels: {
        "wecom-app": config,
      },
    },
  } as never);

  return routes.sort((a, b) => a.localeCompare(b));
}

describe("wecom-app plugin entry", () => {
  beforeEach(() => {
    clearWecomAppRuntime();
  });

  it("registers the channel plugin and stores runtime for setup-only loads", () => {
    const registerChannel = vi.fn();
    const runtime = {};

    entry.register({
      registerChannel,
      runtime,
      registrationMode: "setup-only",
    } as never);

    expect(registerChannel).toHaveBeenCalledWith({ plugin: wecomAppPlugin });
    expect(getWecomAppRuntime()).toBe(runtime);
  });

  it("defaults missing registrationMode to full for legacy hosts", () => {
    const routes = registerWecomAppPlugin({
      webhookPath: "/wecom-app",
      accounts: {
        secondary: { webhookPath: "/wecom-app/custom" },
        duplicate: { webhookPath: "/wecom-app" },
      },
    });

    expect(routes).toEqual(["/wecom-app", "/wecom-app/custom"]);
  });

  it("exports a setup entry that points at the wecom-app plugin surface", () => {
    expect(setupEntry.plugin).toBe(wecomAppSetupPlugin);
    expect(wecomAppSetupPlugin).toBe(wecomAppPlugin);
  });
});
