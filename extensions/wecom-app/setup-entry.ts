import { defineSetupPluginEntry } from "openclaw/plugin-sdk/core";

import { wecomAppPlugin } from "./src/channel.js";

export { wecomAppPlugin as wecomAppSetupPlugin };

export default defineSetupPluginEntry(wecomAppPlugin);
