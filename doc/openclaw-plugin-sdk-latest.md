# OpenClaw Plugin SDK Latest Notes

更新时间：2026-03-24

本文档用于记录当前 `OpenClaw` 主线仓库中，和插件接口、渠道插件实现相关的最新变更与推荐规范，供 `moltbot-china` 开发 China 区渠道扩展时对照使用。

## 1. 核对基线

- 参考仓库：`doc/reference-projects/openclaw`
- 核对分支：`main`
- 本地最新提交：`b61a875d56444881dd6070abddb923378385b2ec`
- 提交时间：2026-03-24 01:46:33 -0500
- 最近发布标签：`v2026.3.23-2`

本次结论同时参考了：

- 本地 `CHANGELOG.md`
- 本地 `docs/plugins/*`
- 本地 `src/plugin-sdk/*`、`src/plugins/types.ts`
- 官方文档站：
  - `https://docs.openclaw.ai/plugins/sdk-migration`
  - `https://docs.openclaw.ai/plugins/sdk-overview`
  - `https://docs.openclaw.ai/plugins/sdk-channel-plugins`
  - `https://docs.openclaw.ai/plugins/sdk-runtime`
  - `https://docs.openclaw.ai/plugins/manifest`

## 2. 这次最重要的接口变化

### 2.1 插件 SDK 入口已经切到窄子路径

现在推荐的公开 SDK 入口是：

```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
```

不再建议继续使用：

- `openclaw/plugin-sdk` 根入口
- `openclaw/plugin-sdk/compat`
- `openclaw/extension-api`

迁移方向是：

- 工具函数改为从 `openclaw/plugin-sdk/<subpath>` 精确导入
- 宿主运行时能力改为走 `api.runtime.*`

例如：

```ts
const result = await api.runtime.agent.runEmbeddedPiAgent({
  sessionId,
  runId,
  sessionFile,
  workspaceDir,
  prompt,
  timeoutMs,
});
```

### 2.2 `openclaw/extension-api` 实际上仍有兼容桥，但已废弃

需要特别注意：

- `CHANGELOG.md` 把 `openclaw/extension-api` 写成 removed
- 但当前主线代码和 `package.json` 导出里仍保留了兼容桥
- 兼容桥会发出 `OPENCLAW_EXTENSION_API_DEPRECATED` 警告

所以当前应按下面的方式理解：

- 对新插件：不要再使用
- 对旧插件：短期还能兼容，但后续会被删掉

同理，`openclaw/plugin-sdk/compat` 也仍有兼容实现，但同样已经废弃。

## 3. 当前最新插件规范

### 3.1 入口文件规范

#### 普通插件

使用 `definePluginEntry(...)`：

```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Example plugin",
  register(api) {
    api.registerTool(/* ... */);
  },
});
```

#### 渠道插件

使用 `defineChannelPluginEntry(...)`：

```ts
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";

export default defineChannelPluginEntry({
  id: "my-channel",
  name: "My Channel",
  description: "Channel plugin",
  plugin: myChannelPlugin,
  setRuntime: setMyRuntime,
  registerFull(api) {
    api.registerCli(/* ... */);
    api.registerGatewayMethod(/* ... */);
  },
});
```

这个 helper 会自动做两件事：

- 调用 `api.registerChannel({ plugin })`
- 根据 `api.registrationMode` 自动区分 setup-only / full 模式

#### setup 轻量入口

如果渠道插件需要轻量 setup 加载，使用 `defineSetupPluginEntry(...)`：

```ts
import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

export default defineSetupPluginEntry(myChannelPlugin);
```

### 3.2 `package.json` 与 `openclaw.plugin.json` 分工

#### `package.json`

负责：

- 入口文件
- `setupEntry`
- channel/provider 元数据
- 安装和启动元数据

渠道插件推荐写法：

```json
{
  "name": "@your-scope/openclaw-my-channel",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "setupEntry": "./setup-entry.ts",
    "channel": {
      "id": "my-channel",
      "label": "My Channel",
      "blurb": "Short description"
    }
  }
}
```

#### `openclaw.plugin.json`

负责：

- 插件发现
- 配置 schema 校验
- provider auth 元数据
- onboarding / UI hints

所有原生插件都必须提供 `openclaw.plugin.json`，而且必须带 JSON Schema，即使是空 schema 也要有。

最小示例：

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

如果是 provider 插件，还可以用这些字段：

- `providers`
- `providerAuthEnvVars`
- `providerAuthChoices`
- `uiHints`

### 3.3 注册 API 规范

`register(api)` 里当前公开可用的核心注册能力包括：

- `api.registerProvider(...)`
- `api.registerChannel(...)`
- `api.registerSpeechProvider(...)`
- `api.registerMediaUnderstandingProvider(...)`
- `api.registerImageGenerationProvider(...)`
- `api.registerWebSearchProvider(...)`
- `api.registerTool(tool, opts?)`
- `api.registerCommand(def)`
- `api.registerHook(events, handler, opts?)`
- `api.registerHttpRoute(params)`
- `api.registerGatewayMethod(name, handler)`
- `api.registerCli(registrar, opts?)`
- `api.registerService(service)`
- `api.registerInteractiveHandler(registration)`
- `api.registerContextEngine(id, factory)`
- `api.registerMemoryPromptSection(builder)`
- `api.onConversationBindingResolved(handler)`

其中比较新的、值得注意的点：

- `api.registerHttpHandler(...)` 已废弃，改用 `api.registerHttpRoute(...)`
- `onConversationBindingResolved(...)` 是新补充的插件回调点
- context engine 现在走更明确的公开注册入口

### 3.4 运行时能力统一走 `api.runtime`

宿主能力不应再直接 import 内部实现，而应使用注入的 `api.runtime`：

- `api.runtime.agent.*`
- `api.runtime.subagent.*`
- `api.runtime.tts.*`
- `api.runtime.mediaUnderstanding.*`
- `api.runtime.imageGeneration.*`
- `api.runtime.webSearch.*`
- `api.runtime.config.*`
- `api.runtime.system.*`
- `api.runtime.events.*`
- `api.runtime.logging.*`
- `api.runtime.modelAuth.*`
- `api.runtime.tools.*`

最常用的迁移关系：

- `runEmbeddedPiAgent` -> `api.runtime.agent.runEmbeddedPiAgent`
- `resolveAgentDir` -> `api.runtime.agent.resolveAgentDir`
- `resolveAgentWorkspaceDir` -> `api.runtime.agent.resolveAgentWorkspaceDir`
- `resolveAgentIdentity` -> `api.runtime.agent.resolveAgentIdentity`
- `resolveThinkingDefault` -> `api.runtime.agent.resolveThinkingDefault`
- `resolveAgentTimeoutMs` -> `api.runtime.agent.resolveAgentTimeoutMs`
- `ensureAgentWorkspace` -> `api.runtime.agent.ensureAgentWorkspace`
- 会话存储 helpers -> `api.runtime.agent.session.*`

如果需要把 runtime 引用拿到 `register()` 外部使用，推荐：

```ts
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";

const runtimeStore = createPluginRuntimeStore("runtime not initialized");
```

## 4. 渠道插件现在应该怎么写

OpenClaw 现在对渠道插件的职责划分更清晰：

渠道插件负责：

- Config
- Security
- Pairing
- Outbound
- Threading
- 渠道自有 action runtime

OpenClaw Core 负责：

- 共享 `message` 工具
- prompt wiring
- session bookkeeping
- dispatch

这意味着渠道插件不需要自己再重新发明一套发送工具；而是挂接到 core 的共享 `message` 工具发现与动作执行机制。

### 4.1 `describeMessageTool(...)` 已成为强约束

新的消息动作发现方式要求实现：

```ts
describeMessageTool(params) => {
  return {
    actions: ["send"],
    capabilities: [],
    schema: null,
  };
}
```

当前 `ChannelMessageActionAdapter` 的关键接口是：

- `describeMessageTool(...)`
- `supportsAction?(...)`
- `requiresTrustedRequesterSender?(...)`
- `extractToolSend?(...)`
- `handleAction?(...)`

其中 `describeMessageTool(...)` 返回：

```ts
type ChannelMessageToolDiscovery = {
  actions?: readonly ChannelMessageActionName[] | null;
  capabilities?: readonly ChannelMessageCapability[] | null;
  schema?: ChannelMessageToolSchemaContribution | ChannelMessageToolSchemaContribution[] | null;
};
```

旧接口已经不再是推荐路径：

- `listActions`
- `getCapabilities`
- `getToolSchema`

这些在最新变更说明中已经被明确移除。

### 4.2 推荐的渠道插件装配方式

渠道插件现在更推荐使用 `createChatChannelPlugin(...)` 加 `createChannelPluginBase(...)` 来组合能力，而不是手写一大坨低层 adapter。

典型装配面包括：

- `setup`
- `security`
- `pairing`
- `threading`
- `outbound`
- `directory`
- `status`
- `gateway`
- `actions`
- `messaging`

这套写法在 `extensions/zalo` 中已经是现成范例。

### 4.3 setup-only 与延迟加载

如果渠道插件有较重的 SDK、加密库、长连接依赖，建议使用：

- `setup-entry.ts`
- `openclaw.setupEntry`
- 可选的 `startup.deferConfiguredChannelFullLoadUntilAfterListen`

这样可以让 setup / configure / doctor 等流程只加载轻量入口，避免把重型 runtime 提前拉起。

但要注意：

- 如果某些 HTTP route 或 gateway method 在 listen 前就必须存在，就不能把它们只放在 full entry 里
- `setupEntry` 必须保证 setup 阶段真正需要的东西仍然可注册

## 5. 测试规范

现在已经有公开测试入口：

```ts
import {
  installCommonResolveTargetErrorCases,
  shouldAckReaction,
  removeAckReactionAfterReply,
} from "openclaw/plugin-sdk/testing";
```

推荐：

- 渠道插件测试直接用 `openclaw/plugin-sdk/testing`
- 不要依赖 OpenClaw 仓库私有的 `extensions/` 内部测试桥接代码
- 避免使用 monolithic `openclaw/plugin-sdk` 根入口
- 避免插件直接 import `../../src/*`
- 避免插件通过自己的 `openclaw/plugin-sdk/<your-plugin>` 路径自引用

## 6. 对 `moltbot-china` 的直接落地建议

对于本仓库里的中国区渠道扩展，建议统一采用下面的目录和职责分层：

```text
extensions/<channel-id>/
  package.json
  openclaw.plugin.json
  index.ts
  setup-entry.ts
  api.ts
  runtime-api.ts
  src/
    channel.ts
    actions.ts
    runtime.ts
    config-schema.ts
    setup-core.ts
    setup-surface.ts
    status-issues.ts
```

建议实现策略：

1. `index.ts`
   使用 `defineChannelPluginEntry(...)`

2. `setup-entry.ts`
   使用 `defineSetupPluginEntry(...)`

3. `src/channel.ts`
   使用 `createChatChannelPlugin(...)`

4. `src/actions.ts`
   实现 `describeMessageTool(...)`、`extractToolSend(...)`、`handleAction(...)`

5. `src/runtime.ts`
   通过 `createPluginRuntimeStore(...)` 保存 runtime

6. `openclaw.plugin.json`
   提供严格的 JSON Schema，并声明 `channels: ["<channel-id>"]`

## 7. 推荐优先级

如果后续要把本仓库现有插件逐步对齐到最新规范，优先顺序建议是：

1. 先清理所有 `openclaw/plugin-sdk` 根入口和 `openclaw/extension-api` 依赖
2. 再把渠道插件动作发现迁移到 `describeMessageTool(...)`
3. 然后补齐 `setup-entry.ts` 和 runtime store 模式
4. 最后再整理测试入口和配置 schema

## 8. 参考定位

本地参考文件：

- `doc/reference-projects/openclaw/CHANGELOG.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-migration.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-overview.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-entrypoints.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-setup.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-channel-plugins.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-runtime.md`
- `doc/reference-projects/openclaw/docs/plugins/sdk-testing.md`
- `doc/reference-projects/openclaw/docs/plugins/manifest.md`
- `doc/reference-projects/openclaw/src/plugin-sdk/core.ts`
- `doc/reference-projects/openclaw/src/channels/plugins/types.core.ts`
- `doc/reference-projects/openclaw/src/plugins/types.ts`
- `doc/reference-projects/openclaw/extensions/zalo/index.ts`
- `doc/reference-projects/openclaw/extensions/zalo/src/channel.ts`
- `doc/reference-projects/openclaw/extensions/zalo/src/actions.ts`

官方在线文档：

- `https://docs.openclaw.ai/plugins/sdk-migration`
- `https://docs.openclaw.ai/plugins/sdk-overview`
- `https://docs.openclaw.ai/plugins/sdk-channel-plugins`
- `https://docs.openclaw.ai/plugins/sdk-runtime`
- `https://docs.openclaw.ai/plugins/manifest`
