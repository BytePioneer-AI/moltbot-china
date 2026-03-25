import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@openclaw-china/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openclaw-china/shared")>();
  return {
    ...actual,
    registerChinaSetupCli: vi.fn(),
    showChinaInstallHint: vi.fn(),
  };
});

import pluginEntry from "../index.js";
import setupEntry from "../setup-entry.js";
import { registerChinaSetupCli, showChinaInstallHint } from "@openclaw-china/shared";
import { dingtalkPlugin } from "./channel.js";
import { dingtalkSetupPlugin } from "./channel.setup.js";
import {
  clearDingtalkRuntime,
  getDingtalkRuntime,
  isDingtalkRuntimeInitialized,
} from "./runtime.js";

afterEach(() => {
  clearDingtalkRuntime();
  vi.clearAllMocks();
});

describe("dingtalk OpenClaw SDK entry", () => {
  it("registers the channel through defineChannelPluginEntry and stores runtime", () => {
    const runtime = {
      channel: {
        text: {
          chunkMarkdownText: vi.fn((text: string) => [text]),
        },
      },
    };
    const api = {
      registrationMode: "full",
      runtime,
      registerChannel: vi.fn(),
      registerCli: vi.fn(),
      logger: {
        info: vi.fn(),
      },
    } as unknown as Parameters<typeof pluginEntry.register>[0];

    pluginEntry.register(api);

    expect(api.registerChannel).toHaveBeenCalledWith({ plugin: dingtalkPlugin });
    expect(registerChinaSetupCli).toHaveBeenCalledWith(api, { channels: ["dingtalk"] });
    expect(showChinaInstallHint).toHaveBeenCalledWith(api);
    expect(isDingtalkRuntimeInitialized()).toBe(true);
    expect(getDingtalkRuntime()).toBe(runtime);
  });

  it("exports setup-entry with the dingtalk plugin surface", () => {
    expect(setupEntry.plugin).toBe(dingtalkSetupPlugin);
    expect(setupEntry.plugin.id).toBe(dingtalkPlugin.id);
    expect(setupEntry.plugin.gateway).toBeUndefined();
    expect(setupEntry.plugin.actions).toBeUndefined();
  });
});

describe("dingtalk policy and pairing surfaces", () => {
  it("exposes pairing-aware DM security and pairing adapters", async () => {
    const cfg = {
      channels: {
        dingtalk: {
          enabled: true,
          clientId: "ding-app-id",
          clientSecret: "ding-app-secret",
          dmPolicy: "pairing",
          allowFrom: ["user-a"],
        },
      },
    };

    const account = dingtalkPlugin.config.resolveAccount(cfg, undefined);
    const dmPolicy = dingtalkPlugin.security?.resolveDmPolicy?.({
      cfg,
      account,
      accountId: account.accountId,
    });

    expect(dmPolicy?.policy).toBe("pairing");
    expect(dmPolicy?.allowFrom).toEqual(["user-a"]);
    expect(dingtalkPlugin.pairing?.idLabel).toBe("dingtalkUserId");
    expect(typeof dingtalkPlugin.pairing?.notifyApproval).toBe("function");
  });
});
