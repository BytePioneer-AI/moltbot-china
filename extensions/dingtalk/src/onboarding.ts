import {
  DEFAULT_ACCOUNT_ID,
  splitSetupEntries,
  type ChannelSetupDmPolicy,
  type ChannelSetupWizard,
  type OpenClawConfig,
  type WizardPrompter,
} from "openclaw/plugin-sdk/setup";
import {
  listDingtalkAccountIds,
  mergeDingtalkAccountConfig,
  moveDingtalkSingleAccountConfigToDefaultAccount,
  normalizeAccountId,
  resolveDefaultDingtalkAccountId,
  resolveDingtalkCredentials,
  type DingtalkConfig,
  type PluginConfig,
} from "./config.js";

type DmPolicy = "open" | "pairing" | "allowlist";
type GroupPolicy = "open" | "allowlist" | "disabled";

function canStoreDefaultAccountInAccounts(cfg: PluginConfig): boolean {
  return Boolean(cfg.channels?.dingtalk?.accounts?.[DEFAULT_ACCOUNT_ID]);
}

function applyDingtalkAccountPatch(
  cfg: PluginConfig,
  accountId: string,
  patch: Record<string, unknown>,
): OpenClawConfig {
  const seededCfg = moveDingtalkSingleAccountConfigToDefaultAccount(cfg);
  const existing = seededCfg.channels?.dingtalk ?? {};

  if (accountId === DEFAULT_ACCOUNT_ID && !canStoreDefaultAccountInAccounts(seededCfg)) {
    return {
      ...seededCfg,
      channels: {
        ...seededCfg.channels,
        dingtalk: {
          ...existing,
          ...patch,
          enabled: true,
        } as DingtalkConfig,
      },
    } as OpenClawConfig;
  }

  const accounts = (existing as DingtalkConfig).accounts ?? {};
  return {
    ...seededCfg,
    channels: {
      ...seededCfg.channels,
      dingtalk: {
        ...existing,
        enabled: true,
        accounts: {
          ...accounts,
          [accountId]: {
            ...accounts[accountId],
            ...patch,
            enabled: true,
          },
        },
      } as DingtalkConfig,
    },
  } as OpenClawConfig;
}

function setDingtalkDmPolicy(cfg: OpenClawConfig, accountId: string, dmPolicy: DmPolicy): OpenClawConfig {
  return applyDingtalkAccountPatch(cfg as PluginConfig, accountId, { dmPolicy });
}

function setDingtalkAllowFrom(
  cfg: OpenClawConfig,
  accountId: string,
  allowFrom: string[],
): OpenClawConfig {
  return applyDingtalkAccountPatch(cfg as PluginConfig, accountId, { allowFrom });
}

function setDingtalkGroupPolicy(
  cfg: OpenClawConfig,
  accountId: string,
  groupPolicy: GroupPolicy,
): OpenClawConfig {
  return applyDingtalkAccountPatch(cfg as PluginConfig, accountId, { groupPolicy });
}

function parseAllowFromInput(raw: string): string[] {
  return splitSetupEntries(raw)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptDingtalkAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId: string;
}): Promise<OpenClawConfig> {
  const account = mergeDingtalkAccountConfig(params.cfg as PluginConfig, params.accountId);
  const existing = account.allowFrom ?? [];

  await params.prompter.note(
    [
      "通过 staffId 或 unionId 设置钉钉私聊白名单。",
      "示例:",
      "- manager1234",
      "- 0123456789012345678",
    ].join("\n"),
    "钉钉白名单",
  );

  const entry = await params.prompter.text({
    message: "钉钉 allowFrom (用户 ID)",
    placeholder: "user1, user2",
    initialValue: existing[0] ? String(existing[0]) : undefined,
    validate: (value) => (String(value ?? "").trim() ? undefined : "必填"),
  });

  const unique = [
    ...new Set([
      ...existing.map((value) => String(value).trim()).filter(Boolean),
      ...parseAllowFromInput(String(entry)),
    ]),
  ];

  return setDingtalkAllowFrom(params.cfg, params.accountId, unique);
}

async function noteDingtalkCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) 访问钉钉开放平台 (open.dingtalk.com)",
      "2) 创建企业内部应用",
      "3) 在「凭证与基础信息」中获取 AppKey 和 AppSecret",
      "4) 在「机器人与消息推送」中启用机器人能力",
      "5) 选择 Stream 或 Webhook 模式接收消息",
    ].join("\n"),
    "钉钉凭证配置",
  );
}

const dingtalkDmPolicy: ChannelSetupDmPolicy = {
  label: "DingTalk",
  channel: "dingtalk",
  policyKey: "channels.dingtalk.dmPolicy",
  allowFromKey: "channels.dingtalk.allowFrom",
  resolveConfigKeys: (_cfg, accountId) => {
    const normalized = normalizeAccountId(accountId);
    if (normalized === DEFAULT_ACCOUNT_ID) {
      return {
        policyKey: "channels.dingtalk.dmPolicy",
        allowFromKey: "channels.dingtalk.allowFrom",
      };
    }
    return {
      policyKey: `channels.dingtalk.accounts.${normalized}.dmPolicy`,
      allowFromKey: `channels.dingtalk.accounts.${normalized}.allowFrom`,
    };
  },
  getCurrent: (cfg, accountId) =>
    mergeDingtalkAccountConfig(cfg as PluginConfig, normalizeAccountId(accountId)).dmPolicy ?? "open",
  setPolicy: (cfg, policy, accountId) =>
    setDingtalkDmPolicy(
      cfg,
      normalizeAccountId(accountId),
      policy === "pairing" || policy === "allowlist" ? policy : "open",
    ),
  promptAllowFrom: async ({ cfg, prompter, accountId }) =>
    await promptDingtalkAllowFrom({
      cfg,
      prompter,
      accountId: normalizeAccountId(accountId),
    }),
};

function isDingtalkConfigured(cfg: OpenClawConfig): boolean {
  return listDingtalkAccountIds(cfg as PluginConfig).some((accountId) =>
    Boolean(resolveDingtalkCredentials(mergeDingtalkAccountConfig(cfg as PluginConfig, accountId))),
  );
}

export const dingtalkSetupWizard: ChannelSetupWizard = {
  channel: "dingtalk",
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs app credentials",
    configuredHint: "已配置",
    unconfiguredHint: "需要应用凭证",
    configuredScore: 2,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) => isDingtalkConfigured(cfg),
    resolveStatusLines: ({ cfg, configured }) => {
      if (!configured) {
        return ["DingTalk: 需要配置应用凭证"];
      }
      const defaultAccountId = resolveDefaultDingtalkAccountId(cfg as PluginConfig);
      return [
        defaultAccountId === DEFAULT_ACCOUNT_ID
          ? "DingTalk: 已配置"
          : `DingTalk: 已配置 (default=${defaultAccountId})`,
      ];
    },
  },
  credentials: [],
  resolveAccountIdForConfigure: ({ accountOverride, cfg }) =>
    normalizeAccountId(accountOverride ?? resolveDefaultDingtalkAccountId(cfg as PluginConfig)),
  finalize: async ({ cfg, accountId, prompter }) => {
    const resolvedAccountId = normalizeAccountId(accountId);
    const current = mergeDingtalkAccountConfig(cfg as PluginConfig, resolvedAccountId);
    let next = cfg;

    if (!resolveDingtalkCredentials(current)) {
      await noteDingtalkCredentialHelp(prompter);
    }

    let shouldKeepExisting = false;
    if (resolveDingtalkCredentials(current)) {
      shouldKeepExisting = await prompter.confirm({
        message: "钉钉凭证已配置，是否保留？",
        initialValue: true,
      });
    }

    if (!shouldKeepExisting) {
      const clientId = String(
        await prompter.text({
          message: "请输入钉钉 AppKey (clientId)",
          initialValue: current.clientId,
          validate: (value) => (value?.trim() ? undefined : "必填"),
        }),
      ).trim();

      const clientSecret = String(
        await prompter.text({
          message: "请输入钉钉 AppSecret (clientSecret)",
          initialValue: current.clientSecret,
          validate: (value) => (value?.trim() ? undefined : "必填"),
        }),
      ).trim();

      next = applyDingtalkAccountPatch(next as PluginConfig, resolvedAccountId, {
        clientId,
        clientSecret,
      });
    }

    const connectionMode = (await prompter.select({
      message: "钉钉连接模式",
      options: [
        { value: "stream", label: "Stream" },
        { value: "webhook", label: "Webhook" },
      ],
      initialValue: current.connectionMode ?? "stream",
    })) as "stream" | "webhook";
    next = applyDingtalkAccountPatch(next as PluginConfig, resolvedAccountId, { connectionMode });

    const enableAICard = await prompter.confirm({
      message: "是否启用 AI Card 流式响应？",
      initialValue: current.enableAICard ?? false,
    });
    next = applyDingtalkAccountPatch(next as PluginConfig, resolvedAccountId, { enableAICard });

    const groupPolicy = (await prompter.select({
      message: "群聊策略",
      options: [
        { value: "open", label: "开放" },
        { value: "allowlist", label: "白名单" },
        { value: "disabled", label: "禁用" },
      ],
      initialValue: current.groupPolicy ?? "open",
    })) as GroupPolicy;
    next = setDingtalkGroupPolicy(next, resolvedAccountId, groupPolicy);

    return { cfg: next };
  },
  dmPolicy: dingtalkDmPolicy,
  disable: (cfg) =>
    ({
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...cfg.channels?.dingtalk,
          enabled: false,
        },
      },
    }) as OpenClawConfig,
};
