import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";
import { dingtalkSetupPlugin } from "./src/channel.setup.js";

export { dingtalkSetupPlugin } from "./src/channel.setup.js";

export default defineSetupPluginEntry(dingtalkSetupPlugin);
