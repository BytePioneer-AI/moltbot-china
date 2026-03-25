import { describe, expect, it } from "vitest";
import { dingtalkPlugin } from "./channel.js";
import type { PluginConfig } from "./config.js";

function asConfig(value: PluginConfig): PluginConfig {
  return value;
}

describe("dingtalk multi-account setup", () => {
  it("migrates legacy root credentials into accounts.default before adding a named account", () => {
    const setup = dingtalkPlugin.setup;
    if (!setup) {
      throw new Error("dingtalk setup adapter missing");
    }

    const next = setup.applyAccountConfig({
      cfg: asConfig({
        channels: {
          dingtalk: {
            enabled: true,
            clientId: "default-id",
            clientSecret: "default-secret",
            enableAICard: false,
          },
        },
      }),
      accountId: "work",
      input: {
        clientId: "work-id",
        clientSecret: "work-secret",
      } as unknown as Parameters<typeof setup.applyAccountConfig>[0]["input"],
    }) as PluginConfig;

    expect(next.channels?.dingtalk).toEqual({
      enabled: true,
      accounts: {
        default: {
          clientId: "default-id",
          clientSecret: "default-secret",
          enableAICard: false,
        },
        work: {
          enabled: true,
          clientId: "work-id",
          clientSecret: "work-secret",
        },
      },
    });
  });

  it("applies omitted setup updates to the resolved default account", () => {
    const setup = dingtalkPlugin.setup;
    if (!setup) {
      throw new Error("dingtalk setup adapter missing");
    }

    const next = setup.applyAccountConfig({
      cfg: asConfig({
        channels: {
          dingtalk: {
            defaultAccount: "main",
            accounts: {
              main: {
                clientId: "main-id",
                clientSecret: "main-secret",
              },
            },
          },
        },
      }),
      accountId: "main",
      input: {
        name: "Main Bot",
      } as unknown as Parameters<typeof setup.applyAccountConfig>[0]["input"],
    }) as PluginConfig;

    expect(next.channels?.dingtalk).toMatchObject({
      defaultAccount: "main",
      enabled: true,
      accounts: {
        main: {
          enabled: true,
          clientId: "main-id",
          clientSecret: "main-secret",
          name: "Main Bot",
        },
      },
    });
  });
});

describe("dingtalk multi-account deletion", () => {
  it("deletes the resolved default account without dropping sibling accounts", () => {
    const deleteAccount = dingtalkPlugin.config.deleteAccount;
    if (!deleteAccount) {
      throw new Error("dingtalk deleteAccount adapter missing");
    }

    const next = deleteAccount({
      cfg: asConfig({
        channels: {
          dingtalk: {
            defaultAccount: "main",
            accounts: {
              main: {
                clientId: "main-id",
                clientSecret: "main-secret",
              },
              work: {
                clientId: "work-id",
                clientSecret: "work-secret",
              },
            },
          },
        },
      }),
      accountId: "main",
    }) as PluginConfig;

    expect(next.channels?.dingtalk).toEqual({
      defaultAccount: "work",
      accounts: {
        work: {
          clientId: "work-id",
          clientSecret: "work-secret",
        },
      },
    });
  });

  it("removes only accounts.default when deleting a promoted default account", () => {
    const deleteAccount = dingtalkPlugin.config.deleteAccount;
    if (!deleteAccount) {
      throw new Error("dingtalk deleteAccount adapter missing");
    }

    const next = deleteAccount({
      cfg: asConfig({
        channels: {
          dingtalk: {
            enabled: true,
            accounts: {
              default: {
                clientId: "default-id",
                clientSecret: "default-secret",
              },
              work: {
                clientId: "work-id",
                clientSecret: "work-secret",
              },
            },
          },
        },
      }),
      accountId: "default",
    }) as PluginConfig;

    expect(next.channels?.dingtalk).toEqual({
      enabled: true,
      accounts: {
        work: {
          clientId: "work-id",
          clientSecret: "work-secret",
        },
      },
    });
  });
});

describe("dingtalk messaging target normalization", () => {
  it("normalizes host-facing targets to canonical user/group prefixes", () => {
    const normalize = dingtalkPlugin.messaging?.normalizeTarget;
    if (!normalize) {
      throw new Error("dingtalk messaging.normalizeTarget missing");
    }

    expect(normalize("user:user-a")).toBe("user:user-a");
    expect(normalize("group:group-a")).toBe("group:group-a");
    expect(normalize("channel:group-a")).toBe("group:group-a");
    expect(normalize("chat:group-a")).toBe("group:group-a");
    expect(normalize("dingtalk:group:group-a")).toBe("group:group-a");
    expect(normalize("@user-a")).toBe("user:user-a");
    expect(normalize("#group-a")).toBe("group:group-a");
    expect(normalize("user-a")).toBe("user:user-a");
  });
});
