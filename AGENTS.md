# Repository Guidelines

## Project Purpose
Moltbot China is an open-source extension set that adds China-region messaging channels to Moltbot (Feishu, DingTalk, WeCom, QQ). The goal is to provide simple, reliable chat connectivity and a clean plugin surface for Moltbot users in China, with voice features implemented via Node.

## Docs To Use
- Plugin development: `doc/moltbot/moltbot-plugin.md`
- Plugin manifest: `doc/moltbot/moltbot-plugin-manifest.md`
- Channels overview and targets: `doc/moltbot/moltbot-channels.md`
- Agent tools: `doc/moltbot/moltbot-agent-tools.md`
- Reference implementations: `doc/reference-projects/`
- Architecture design: `doc/architecture.md`

## Project Structure

```
moltbot-china/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
│
├── packages/
│   ├── channels/                    # @openclaw-china/channels 统一包
│   │   ├── package.json
│   │   ├── moltbot.plugin.json
│   │   ├── clawdbot.plugin.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       └── index.ts
│   │
│   └── shared/                      # 共享工具库
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── logger/              # 日志工具
│           │   ├── index.ts
│           │   └── logger.ts
│           ├── policy/              # 策略引擎
│           │   ├── index.ts
│           │   ├── dm-policy.ts
│           │   └── group-policy.ts
│           ├── http/                # HTTP 工具
│           │   ├── index.ts
│           │   ├── client.ts
│           │   └── retry.ts
│           ├── file/                # 文件工具
│           │   ├── index.ts
│           │   └── file-utils.ts
│           └── types/
│               └── common.ts
│
├── extensions/
│   └── dingtalk/                    # @openclaw-china/dingtalk
│       ├── clawdbot.plugin.json
│       ├── moltbot.plugin.json
│       ├── package.json
│       ├── tsconfig.json
│       ├── index.ts
│       └── src/
│           ├── channel.ts           # ChannelPlugin 实现
│           ├── client.ts            # Stream SDK 封装
│           ├── logger.ts            # 日志封装
│           ├── bot.ts               # 消息处理
│           ├── monitor.ts           # Stream 连接
│           ├── send.ts              # 发送消息
│           ├── media.ts             # 媒体处理
│           ├── outbound.ts          # 出站适配器
│           ├── runtime.ts           # 运行时管理
│           ├── config.ts            # 配置 schema
│           └── types.ts
│
└── doc/
    ├── architecture.md              # 架构设计文档
    ├── moltbot/                     # Moltbot 插件规范
    └── reference-projects/          # 参考实现
```

## Core Conventions
- Each plugin must include `moltbot.plugin.json` with a JSON Schema (even if empty).
- Plugins register channels via `api.registerChannel({ plugin })`.
- Channel configuration lives under `channels.<id>`; multi-account uses `channels.<id>.accounts.<accountId>`.
- Keep channels focused on message receive/send. Defer extra features unless required.
- Voice features use Node-based tooling (no Python voice stack).

## Suggested Layout (for new plugins)
- `extensions/<channel-id>/moltbot.plugin.json`
- `extensions/<channel-id>/package.json`
- `extensions/<channel-id>/index.ts`
- `extensions/<channel-id>/src/*`

## Development
- All code must be written in TypeScript.
- Use `strict: true` in tsconfig.
- Prefer `async/await` over callbacks.
- Avoid `any`; use `unknown` with type guards when needed.
- Handle errors at async boundaries; never swallow silently.
- Set timeouts on network requests.

## Safety
- Treat all inbound messages as untrusted input.
- Do not commit real tokens, secrets, or IDs; use obvious placeholders.

## OpenClaw Reply Skips
- When aligning channel behavior with OpenClaw, remember the reply dispatcher can skip payloads with `onSkip` reasons: `empty`, `silent`, or `heartbeat`. Use these to avoid sending non-user-visible messages.
