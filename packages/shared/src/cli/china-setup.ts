import {
  cancel as clackCancel,
  confirm as clackConfirm,
  intro as clackIntro,
  isCancel,
  note as clackNote,
  outro as clackOutro,
  select as clackSelect,
  text as clackText,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";

type LoggerLike = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

type CommandLike = {
  command: (name: string) => CommandLike;
  description: (text: string) => CommandLike;
  action: (handler: () => void | Promise<void>) => CommandLike;
};

type ChinaCliContext = {
  program: unknown;
  config?: unknown;
  logger?: LoggerLike;
};

type RegisterCliLike = (
  registrar: (ctx: ChinaCliContext) => void | Promise<void>,
  opts?: { commands?: string[] }
) => void;

type WriteConfigLike = (cfg: ConfigRoot) => Promise<void>;

type ApiLike = {
  registerCli?: RegisterCliLike;
  runtime?: unknown;
  logger?: LoggerLike;
};

type ConfigRecord = Record<string, unknown>;

type ConfigRoot = {
  channels?: ConfigRecord;
  [key: string]: unknown;
};

export type ChannelId = "dingtalk" | "feishu-china" | "wecom" | "wecom-app" | "qqbot";

export type RegisterChinaSetupCliOptions = {
  channels?: readonly ChannelId[];
};

type Option<T extends string> = {
  key?: string;
  value: T;
  label: string;
};

const PROJECT_REPO = "https://github.com/BytePioneer-AI/openclaw-china";
const GUIDES_BASE = "https://github.com/BytePioneer-AI/openclaw-china/tree/main/doc/guides";
const OPENCLAW_HOME = join(homedir(), ".openclaw");
const DEFAULT_PLUGIN_PATH = join(OPENCLAW_HOME, "extensions");
const LEGACY_PLUGIN_PATH = join(OPENCLAW_HOME, "plugins");
const CONFIG_FILE_PATH = join(OPENCLAW_HOME, "openclaw.json");
const ANSI_RESET = "\u001b[0m";
const ANSI_LINK = "\u001b[1;4;96m";
const ANSI_BORDER = "\u001b[92m";
const CHANNEL_ORDER: readonly ChannelId[] = [
  "dingtalk",
  "qqbot",
  "wecom",
  "wecom-app",
  "feishu-china",
];
const CHANNEL_DISPLAY_LABELS: Record<ChannelId, string> = {
  dingtalk: "DingTalk（钉钉）",
  "feishu-china": "Feishu（飞书）",
  wecom: "WeCom（企业微信-智能机器人）",
  "wecom-app": "WeCom App（自建应用-可接入微信）",
  qqbot: "QQBot（QQ 机器人）",
};
const CHANNEL_GUIDE_LINKS: Record<ChannelId, string> = {
  dingtalk: `${GUIDES_BASE}/dingtalk/configuration.md`,
  "feishu-china": "https://github.com/BytePioneer-AI/openclaw-china/blob/main/README.md",
  wecom: `${GUIDES_BASE}/wecom/configuration.md`,
  "wecom-app": `${GUIDES_BASE}/wecom-app/configuration.md`,
  qqbot: `${GUIDES_BASE}/qqbot/configuration.md`,
};
const CHINA_CLI_STATE_KEY = Symbol.for("@openclaw-china/china-cli-state");

type ChinaCliState = {
  channels: Set<ChannelId>;
  cliRegistered: boolean;
};

class PromptCancelledError extends Error {
  constructor() {
    super("prompt-cancelled");
  }
}

function isChannelId(value: unknown): value is ChannelId {
  return typeof value === "string" && CHANNEL_ORDER.includes(value as ChannelId);
}

function getChinaCliState(): ChinaCliState {
  const root = globalThis as Record<PropertyKey, unknown>;
  const cached = root[CHINA_CLI_STATE_KEY];

  if (isRecord(cached)) {
    const channels = cached.channels;
    const cliRegistered = cached.cliRegistered;
    if (channels instanceof Set && typeof cliRegistered === "boolean") {
      return {
        channels: channels as Set<ChannelId>,
        cliRegistered,
      };
    }
  }

  const created: ChinaCliState = {
    channels: new Set<ChannelId>(),
    cliRegistered: false,
  };
  root[CHINA_CLI_STATE_KEY] = created;
  return created;
}

function normalizeChannels(channels?: readonly ChannelId[]): ChannelId[] {
  const selected = channels && channels.length > 0 ? channels : CHANNEL_ORDER;
  const unique = new Set<ChannelId>();
  for (const channelId of selected) {
    if (isChannelId(channelId)) {
      unique.add(channelId);
    }
  }
  return CHANNEL_ORDER.filter((channelId) => unique.has(channelId));
}

function getInstalledChannels(state: ChinaCliState): ChannelId[] {
  return CHANNEL_ORDER.filter((channelId) => state.channels.has(channelId));
}

function guardCancel<T>(value: T | symbol): T {
  if (isCancel(value)) {
    clackCancel("已取消配置。");
    throw new PromptCancelledError();
  }
  return value as T;
}

function warn(text: string): void {
  output.write(`\n[warn] ${text}\n`);
}

function section(title: string): void {
  output.write(`\n${title}\n`);
}

function resolvePluginPath(): string {
  if (existsSync(DEFAULT_PLUGIN_PATH)) {
    return DEFAULT_PLUGIN_PATH;
  }
  if (existsSync(LEGACY_PLUGIN_PATH)) {
    return LEGACY_PLUGIN_PATH;
  }
  return DEFAULT_PLUGIN_PATH;
}

function renderReadyMessage(): string {
  return [
    `${ANSI_BORDER}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}`,
    "  OpenClaw China Channels 已就绪!",
    `${ANSI_BORDER}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${ANSI_RESET}`,
    "",
    "插件路径:",
    `  ${resolvePluginPath()}`,
    "",
    "配置文件:",
    `  ${CONFIG_FILE_PATH}`,
    "",
    "更新插件:",
    "  openclaw plugins update <plugin-id>",
    "",
    "项目仓库:",
    `  ${ANSI_LINK}${PROJECT_REPO}${ANSI_RESET}`,
    "",
    "⭐ 如果这个项目对你有帮助，请给我们一个 Star！⭐",
    "",
    "下一步:",
    "  openclaw gateway --port 18789 --verbose",
    "",
  ].join("\n");
}

function showReadyMessage(): void {
  output.write(`\n${renderReadyMessage()}\n`);
}

function showGuideLink(channelId: ChannelId): void {
  const url = CHANNEL_GUIDE_LINKS[channelId];
  clackNote(`配置文档：${url}`, "Docs");
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveWriteConfig(runtime: unknown): WriteConfigLike | undefined {
  if (!isRecord(runtime)) {
    return undefined;
  }
  const config = runtime.config;
  if (!isRecord(config)) {
    return undefined;
  }
  if (typeof config.writeConfigFile !== "function") {
    return undefined;
  }
  return config.writeConfigFile as WriteConfigLike;
}

function isCommandLike(value: unknown): value is CommandLike {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.command === "function" &&
    typeof value.description === "function" &&
    typeof value.action === "function"
  );
}

function toTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function hasNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function cloneConfig(cfg: ConfigRoot): ConfigRoot {
  try {
    return structuredClone(cfg);
  } catch {
    return JSON.parse(JSON.stringify(cfg)) as ConfigRoot;
  }
}

function getChannelConfig(cfg: ConfigRoot, channelId: ChannelId): ConfigRecord {
  const channels = isRecord(cfg.channels) ? cfg.channels : {};
  const existing = channels[channelId];
  return isRecord(existing) ? existing : {};
}

function getPreferredAccountConfig(channelCfg: ConfigRecord): ConfigRecord | undefined {
  const accounts = channelCfg.accounts;
  if (!isRecord(accounts)) {
    return undefined;
  }

  const defaultAccountId = toTrimmedString(channelCfg.defaultAccount);
  if (defaultAccountId) {
    const preferred = accounts[defaultAccountId];
    if (isRecord(preferred)) {
      return preferred;
    }
  }

  for (const value of Object.values(accounts)) {
    if (isRecord(value)) {
      return value;
    }
  }
  return undefined;
}

function hasTokenPair(channelCfg: ConfigRecord): boolean {
  if (hasNonEmptyString(channelCfg.token) && hasNonEmptyString(channelCfg.encodingAESKey)) {
    return true;
  }
  const accountCfg = getPreferredAccountConfig(channelCfg);
  return Boolean(
    accountCfg &&
      hasNonEmptyString(accountCfg.token) &&
      hasNonEmptyString(accountCfg.encodingAESKey)
  );
}

function isChannelConfigured(cfg: ConfigRoot, channelId: ChannelId): boolean {
  const channelCfg = getChannelConfig(cfg, channelId);
  switch (channelId) {
    case "dingtalk":
      return hasNonEmptyString(channelCfg.clientId) && hasNonEmptyString(channelCfg.clientSecret);
    case "feishu-china":
      return hasNonEmptyString(channelCfg.appId) && hasNonEmptyString(channelCfg.appSecret);
    case "qqbot":
      return hasNonEmptyString(channelCfg.appId) && hasNonEmptyString(channelCfg.clientSecret);
    case "wecom":
    case "wecom-app":
      return hasTokenPair(channelCfg);
    default:
      return false;
  }
}

function withConfiguredSuffix(cfg: ConfigRoot, channelId: ChannelId): string {
  const base = CHANNEL_DISPLAY_LABELS[channelId];
  return isChannelConfigured(cfg, channelId) ? `${base}（已配置）` : base;
}

function mergeChannelConfig(
  cfg: ConfigRoot,
  channelId: ChannelId,
  patch: ConfigRecord
): ConfigRoot {
  const channels = isRecord(cfg.channels) ? { ...cfg.channels } : {};
  const existing = getChannelConfig(cfg, channelId);
  channels[channelId] = {
    ...existing,
    ...patch,
    enabled: true,
  };
  return {
    ...cfg,
    channels,
  };
}

class SetupPrompter {
  async askText(params: {
    label: string;
    required?: boolean;
    defaultValue?: string;
  }): Promise<string> {
    const { label, required = false, defaultValue } = params;
    while (true) {
      const value = String(
        guardCancel(
          await clackText({
            message: label,
            initialValue: defaultValue,
          })
        )
      ).trim();

      if (value) {
        return value;
      }
      if (defaultValue) {
        return defaultValue;
      }
      if (!required) {
        return "";
      }
      warn("该字段为必填项。");
    }
  }

  async askSecret(params: {
    label: string;
    existingValue?: string;
    required?: boolean;
  }): Promise<string> {
    const { label, existingValue, required = true } = params;
    return this.askText({
      label,
      required,
      defaultValue: existingValue,
    });
  }

  async askConfirm(label: string, defaultValue = true): Promise<boolean> {
    return Boolean(
      guardCancel(
        await clackConfirm({
          message: label,
          initialValue: defaultValue,
        })
      )
    );
  }

  async askNumber(params: {
    label: string;
    min?: number;
    defaultValue?: number;
  }): Promise<number> {
    const { label, min, defaultValue } = params;
    while (true) {
      const raw = String(
        guardCancel(
          await clackText({
            message: label,
            initialValue: defaultValue !== undefined ? String(defaultValue) : undefined,
          })
        )
      ).trim();

      const parsed = Number.parseInt(raw, 10);
      if (Number.isFinite(parsed) && (min === undefined || parsed >= min)) {
        return parsed;
      }
      warn(`请输入有效整数${min !== undefined ? `（>= ${min}）` : ""}。`);
    }
  }

  async askSelect<T extends string>(
    message: string,
    options: Array<Option<T>>,
    defaultValue: T
  ): Promise<T> {
    const initial = options.some((opt) => opt.value === defaultValue)
      ? defaultValue
      : options[0]?.value;
    const selectOptions = options.map((option) => ({
      value: option.value,
      label: option.label,
    })) as Parameters<typeof clackSelect<T>>[0]["options"];

    return guardCancel(
      await clackSelect<T>({
        message,
        options: selectOptions,
        initialValue: initial,
      })
    );
  }
}

async function configureDingtalk(prompter: SetupPrompter, cfg: ConfigRoot): Promise<ConfigRoot> {
  section("配置 DingTalk（钉钉）");
  showGuideLink("dingtalk");
  const existing = getChannelConfig(cfg, "dingtalk");

  const clientId = await prompter.askText({
    label: "DingTalk clientId（AppKey）",
    defaultValue: toTrimmedString(existing.clientId),
    required: true,
  });
  const clientSecret = await prompter.askSecret({
    label: "DingTalk clientSecret（AppSecret）",
    existingValue: toTrimmedString(existing.clientSecret),
    required: true,
  });
  const enableAICard = await prompter.askConfirm(
    "启用 AI Card 流式回复（推荐关闭，使用非流式）",
    toBoolean(existing.enableAICard, false)
  );

  return mergeChannelConfig(cfg, "dingtalk", {
    clientId,
    clientSecret,
    enableAICard,
  });
}

async function configureFeishu(prompter: SetupPrompter, cfg: ConfigRoot): Promise<ConfigRoot> {
  section("配置 Feishu（飞书）");
  showGuideLink("feishu-china");
  const existing = getChannelConfig(cfg, "feishu-china");

  const appId = await prompter.askText({
    label: "Feishu appId",
    defaultValue: toTrimmedString(existing.appId),
    required: true,
  });
  const appSecret = await prompter.askSecret({
    label: "Feishu appSecret",
    existingValue: toTrimmedString(existing.appSecret),
    required: true,
  });
  const sendMarkdownAsCard = await prompter.askConfirm(
    "以卡片形式发送 Markdown",
    toBoolean(existing.sendMarkdownAsCard, true)
  );
  return mergeChannelConfig(cfg, "feishu-china", {
    appId,
    appSecret,
    sendMarkdownAsCard,
  });
}

async function configureWecom(prompter: SetupPrompter, cfg: ConfigRoot): Promise<ConfigRoot> {
  section("配置 WeCom（企业微信-智能机器人）");
  showGuideLink("wecom");
  const existing = getChannelConfig(cfg, "wecom");

  const webhookPath = await prompter.askText({
    label: "Webhook 路径（需与企业微信后台配置一致，默认 /wecom）",
    defaultValue: toTrimmedString(existing.webhookPath) ?? "/wecom",
    required: true,
  });
  const token = await prompter.askSecret({
    label: "WeCom token",
    existingValue: toTrimmedString(existing.token),
    required: true,
  });
  const encodingAESKey = await prompter.askSecret({
    label: "WeCom encodingAESKey",
    existingValue: toTrimmedString(existing.encodingAESKey),
    required: true,
  });
  return mergeChannelConfig(cfg, "wecom", {
    webhookPath,
    token,
    encodingAESKey,
  });
}

async function configureWecomApp(prompter: SetupPrompter, cfg: ConfigRoot): Promise<ConfigRoot> {
  section("配置 WeCom App（自建应用-可接入微信）");
  showGuideLink("wecom-app");
  const existing = getChannelConfig(cfg, "wecom-app");
  const existingAsr = isRecord(existing.asr) ? existing.asr : {};

  const webhookPath = await prompter.askText({
    label: "Webhook 路径（需与企业微信后台配置一致，默认 /wecom-app）",
    defaultValue: toTrimmedString(existing.webhookPath) ?? "/wecom-app",
    required: true,
  });
  const token = await prompter.askSecret({
    label: "WeCom App token",
    existingValue: toTrimmedString(existing.token),
    required: true,
  });
  const encodingAESKey = await prompter.askSecret({
    label: "WeCom App encodingAESKey",
    existingValue: toTrimmedString(existing.encodingAESKey),
    required: true,
  });

  const patch: ConfigRecord = {
    webhookPath,
    token,
    encodingAESKey,
  };

  const corpId = await prompter.askText({
    label: "corpId",
    defaultValue: toTrimmedString(existing.corpId),
    required: true,
  });
  const corpSecret = await prompter.askSecret({
    label: "corpSecret",
    existingValue: toTrimmedString(existing.corpSecret),
    required: true,
  });
  const agentId = await prompter.askNumber({
    label: "agentId",
    min: 1,
    defaultValue: toNumber(existing.agentId),
  });
  patch.corpId = corpId;
  patch.corpSecret = corpSecret;
  patch.agentId = agentId;
  const asrEnabled = await prompter.askConfirm(
    "启用 ASR（支持入站语音自动转文字）",
    toBoolean(existingAsr.enabled, false)
  );
  const asr: ConfigRecord = {
    enabled: asrEnabled,
  };
  if (asrEnabled) {
    clackNote(
      [
        "ASR 开通方式请查看配置文档：步骤七（可选）：开启语音转文本（ASR）",
        "https://github.com/BytePioneer-AI/openclaw-china/blob/main/doc/guides/wecom-app/configuration.md",
      ].join("\n"),
      "提示"
    );
    asr.appId = await prompter.askText({
      label: "ASR appId（腾讯云）",
      defaultValue: toTrimmedString(existingAsr.appId),
      required: true,
    });
    asr.secretId = await prompter.askSecret({
      label: "ASR secretId（腾讯云）",
      existingValue: toTrimmedString(existingAsr.secretId),
      required: true,
    });
    asr.secretKey = await prompter.askSecret({
      label: "ASR secretKey（腾讯云）",
      existingValue: toTrimmedString(existingAsr.secretKey),
      required: true,
    });
  }
  patch.asr = asr;

  return mergeChannelConfig(cfg, "wecom-app", patch);
}

async function configureQQBot(prompter: SetupPrompter, cfg: ConfigRoot): Promise<ConfigRoot> {
  section("配置 QQBot（QQ 机器人）");
  showGuideLink("qqbot");
  const existing = getChannelConfig(cfg, "qqbot");
  const existingAsr = isRecord(existing.asr) ? existing.asr : {};

  const appId = await prompter.askText({
    label: "QQBot appId",
    defaultValue: toTrimmedString(existing.appId),
    required: true,
  });
  const clientSecret = await prompter.askSecret({
    label: "QQBot clientSecret",
    existingValue: toTrimmedString(existing.clientSecret),
    required: true,
  });
  clackNote(
    "QQ 的 Markdown 体验很好，但需要先申请开通，详情请查看配置文档。",
    "提示"
  );
  const markdownSupport = await prompter.askConfirm(
    "启用 Markdown 支持",
    toBoolean(existing.markdownSupport, false)
  );
  const asrEnabled = await prompter.askConfirm(
    "启用 ASR（支持入站语音自动转文字）",
    toBoolean(existingAsr.enabled, false)
  );

  const asr: ConfigRecord = {
    enabled: asrEnabled,
  };
  if (asrEnabled) {
    clackNote("ASR 开通方式详情请查看配置文档。", "提示");
    asr.appId = await prompter.askText({
      label: "ASR appId（腾讯云）",
      defaultValue: toTrimmedString(existingAsr.appId),
      required: true,
    });
    asr.secretId = await prompter.askSecret({
      label: "ASR secretId（腾讯云）",
      existingValue: toTrimmedString(existingAsr.secretId),
      required: true,
    });
    asr.secretKey = await prompter.askSecret({
      label: "ASR secretKey（腾讯云）",
      existingValue: toTrimmedString(existingAsr.secretKey),
      required: true,
    });
  }

  return mergeChannelConfig(cfg, "qqbot", {
    appId,
    clientSecret,
    markdownSupport,
    asr,
  });
}

async function configureSingleChannel(
  channel: ChannelId,
  prompter: SetupPrompter,
  cfg: ConfigRoot
): Promise<ConfigRoot> {
  switch (channel) {
    case "dingtalk":
      return configureDingtalk(prompter, cfg);
    case "feishu-china":
      return configureFeishu(prompter, cfg);
    case "wecom":
      return configureWecom(prompter, cfg);
    case "wecom-app":
      return configureWecomApp(prompter, cfg);
    case "qqbot":
      return configureQQBot(prompter, cfg);
    default:
      return cfg;
  }
}

async function runChinaSetup(params: {
  initialConfig: ConfigRoot;
  writeConfig?: WriteConfigLike;
  logger: LoggerLike;
  availableChannels: readonly ChannelId[];
}): Promise<void> {
  if (!input.isTTY || !output.isTTY) {
    params.logger.error?.("交互式配置需要在 TTY 终端中运行。");
    return;
  }

  const prompter = new SetupPrompter();
  const touched = new Set<ChannelId>();
  let next = cloneConfig(params.initialConfig);

  try {
    clackIntro("OpenClaw China 配置向导");
    clackNote(
      [
        "使用方向键选择，按 Enter 确认。",
        `项目仓库：${ANSI_LINK}${PROJECT_REPO}${ANSI_RESET}`,
      ].join("\n"),
      "欢迎"
    );

    if (params.availableChannels.length === 0) {
      params.logger.error?.("未检测到可配置的 China 渠道插件。");
      return;
    }

    const channelOptions = params.availableChannels.map((channelId, index) => ({
      key: index === 0 ? "recommended" : "",
      value: channelId,
      label: withConfiguredSuffix(next, channelId),
    }));
    const defaultChannel = channelOptions[0]?.value ?? "save";

    let continueLoop = true;
    while (continueLoop) {
      const selected = await prompter.askSelect<ChannelId | "save" | "cancel">(
        "请选择要配置的渠道",
        [
          ...channelOptions,
          { key: "", value: "save", label: "保存并退出" },
          { key: "", value: "cancel", label: "不保存并退出" },
        ],
        defaultChannel
      );

      if (selected === "cancel") {
        clackCancel("已取消，未写入任何配置。");
        return;
      }

      if (selected === "save") {
        break;
      }

      next = await configureSingleChannel(selected, prompter, next);
      touched.add(selected);
      clackNote(`已完成：${CHANNEL_DISPLAY_LABELS[selected]}`, "完成");

      continueLoop = await prompter.askConfirm("继续配置其他渠道", true);
    }

    if (touched.size === 0) {
      clackCancel("未进行任何修改。");
      return;
    }

    clackNote(
      `已配置渠道：${Array.from(touched)
        .map((channelId) => CHANNEL_DISPLAY_LABELS[channelId])
        .join(", ")}`,
      "摘要"
    );

    if (!params.writeConfig) {
      params.logger.error?.("无法保存配置：当前运行时未提供配置写入能力。");
      return;
    }

    await params.writeConfig(next);
    clackOutro("配置已保存。");
    showReadyMessage();
  } catch (err) {
    if (err instanceof PromptCancelledError) {
      return;
    }
    throw err;
  }
}

export function registerChinaSetupCli(api: ApiLike, opts?: RegisterChinaSetupCliOptions): void {
  const state = getChinaCliState();
  for (const channelId of normalizeChannels(opts?.channels)) {
    state.channels.add(channelId);
  }

  if (state.cliRegistered || typeof api.registerCli !== "function") {
    return;
  }
  state.cliRegistered = true;

  const writeConfig = resolveWriteConfig(api.runtime);
  const fallbackLogger: LoggerLike = {
    info: (message) => output.write(`${message}\n`),
    warn: (message) => warn(message),
    error: (message) => warn(message),
  };

  api.registerCli(
    (ctx) => {
      if (!isCommandLike(ctx.program)) {
        const logger = ctx.logger ?? api.logger ?? fallbackLogger;
        logger.error?.("无法注册 china 命令：CLI program 实例无效。");
        return;
      }

      const root = ctx.program.command("china").description("OpenClaw China 插件命令");

      root
        .command("setup")
        .description("中国渠道交互式配置向导")
        .action(async () => {
          const logger = ctx.logger ?? api.logger ?? fallbackLogger;
          const availableChannels = getInstalledChannels(state);
          await runChinaSetup({
            initialConfig: isRecord(ctx.config) ? (ctx.config as ConfigRoot) : {},
            writeConfig,
            logger,
            availableChannels,
          });
        });

      root.command("about").description("显示项目信息").action(() => {
        const installed = getInstalledChannels(state);
        clackIntro("OpenClaw China 渠道插件");
        clackNote(
          installed.length > 0
            ? `当前已安装渠道：${installed.map((channelId) => CHANNEL_DISPLAY_LABELS[channelId]).join("、")}`
            : "OpenClaw China 渠道插件",
          "关于"
        );
        clackOutro(PROJECT_REPO);
        showReadyMessage();
      });
    },
    { commands: ["china"] }
  );
}

