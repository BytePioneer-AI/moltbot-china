import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const sharedPath = path.join(root, "packages", "shared", "package.json");
const dingtalkPath = path.join(root, "extensions", "dingtalk", "package.json");
const feishuPath = path.join(root, "extensions", "feishu", "package.json");
const wecomPath = path.join(root, "extensions", "wecom", "package.json");
const wecomAppPath = path.join(root, "extensions", "wecom-app", "package.json");
const qqbotPath = path.join(root, "extensions", "qqbot", "package.json");
const channelsPath = path.join(root, "packages", "channels", "package.json");
const channelIds = ["dingtalk", "feishu-china", "wecom", "wecom-app", "qqbot"];

function printUsage() {
  console.log(`
Usage:
  node scripts/release-all.mjs
  node scripts/release-all.mjs <channel>
  node scripts/release-all.mjs --channel <channel> [--with-shared]

Channels:
  ${channelIds.join(", ")}

Options:
  --with-shared    Also bump & publish @openclaw-china/shared
`);
}

function parseArgs(args) {
  let channel = null;
  let withShared = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg === "--with-shared") {
      withShared = true;
      continue;
    }
    if (arg === "--channel" || arg === "-c") {
      const next = args[i + 1];
      if (!next) {
        throw new Error("Missing channel after --channel");
      }
      channel = next;
      i += 1;
      continue;
    }
    if (!arg.startsWith("-") && !channel) {
      channel = arg;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    mode: channel ? "channel" : "all",
    channel,
    withShared,
  };
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf-8"));
}

function writeJson(p, data) {
  writeFileSync(p, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function bumpPatch(version) {
  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid version: ${version}`);
  }
  const [major, minor, patch] = parts.map((p) => Number(p));
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    throw new Error(`Invalid version: ${version}`);
  }
  return `${major}.${minor}.${patch + 1}`;
}

function run(cmd, cwd = root) {
  execSync(cmd, { stdio: "inherit", cwd });
}

function parseVersion(version) {
  const parts = version.split(".");
  if (parts.length !== 3) {
    throw new Error(`Invalid version: ${version}`);
  }
  const [major, minor, patch] = parts.map((p) => Number(p));
  if (!Number.isInteger(major) || !Number.isInteger(minor) || !Number.isInteger(patch)) {
    throw new Error(`Invalid version: ${version}`);
  }
  return { major, minor, patch };
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function getLatestPublishedVersion(pkgName) {
  try {
    const result = execSync(`npm view ${pkgName} version --json`, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    if (!result) return null;
    const parsed = JSON.parse(result);
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed[parsed.length - 1];
    return null;
  } catch (error) {
    const stderr = error?.stderr?.toString?.() ?? "";
    if (stderr.includes("E404") || stderr.includes("Not found")) {
      return null;
    }
    throw error;
  }
}

function getNextVersion(pkgName, localVersion) {
  const latest = getLatestPublishedVersion(pkgName);
  if (!latest) {
    return bumpPatch(localVersion);
  }
  const latestParsed = parseVersion(latest);
  const localParsed = parseVersion(localVersion);
  const base = compareVersions(latestParsed, localParsed) >= 0 ? latest : localVersion;
  return bumpPatch(base);
}

const sharedPkg = readJson(sharedPath);
const dingtalkPkg = readJson(dingtalkPath);
const feishuPkg = readJson(feishuPath);
const wecomPkg = readJson(wecomPath);
const wecomAppPkg = readJson(wecomAppPath);
const qqbotPkg = readJson(qqbotPath);
const channelsPkg = readJson(channelsPath);

const originalShared = readJson(sharedPath);
const originalDingtalk = readJson(dingtalkPath);
const originalFeishu = readJson(feishuPath);
const originalWecom = readJson(wecomPath);
const originalWecomApp = readJson(wecomAppPath);
const originalQqbot = readJson(qqbotPath);
const originalChannels = readJson(channelsPath);

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.channel === "feishu") {
    options.channel = "feishu-china";
  }
  const channelMap = {
    dingtalk: { pkg: dingtalkPkg, path: dingtalkPath },
    "feishu-china": { pkg: feishuPkg, path: feishuPath },
    wecom: { pkg: wecomPkg, path: wecomPath },
    "wecom-app": { pkg: wecomAppPkg, path: wecomAppPath },
    qqbot: { pkg: qqbotPkg, path: qqbotPath },
  };

  if (options.mode === "all") {
    const nextShared = getNextVersion(sharedPkg.name, sharedPkg.version);
    const nextDingtalk = getNextVersion(dingtalkPkg.name, dingtalkPkg.version);
    const nextFeishu = getNextVersion(feishuPkg.name, feishuPkg.version);
    const nextWecom = getNextVersion(wecomPkg.name, wecomPkg.version);
    const nextWecomApp = getNextVersion(wecomAppPkg.name, wecomAppPkg.version);
    const nextQqbot = getNextVersion(qqbotPkg.name, qqbotPkg.version);
    const nextChannels = getNextVersion(channelsPkg.name, channelsPkg.version);

    sharedPkg.version = nextShared;
    sharedPkg.private = false;

    dingtalkPkg.version = nextDingtalk;
    dingtalkPkg.private = false;
    dingtalkPkg.dependencies = dingtalkPkg.dependencies ?? {};
    dingtalkPkg.dependencies["@openclaw-china/shared"] = nextShared;

    feishuPkg.version = nextFeishu;
    feishuPkg.private = false;
    feishuPkg.dependencies = feishuPkg.dependencies ?? {};
    feishuPkg.dependencies["@openclaw-china/shared"] = nextShared;

    wecomPkg.version = nextWecom;
    wecomPkg.private = false;
    wecomPkg.dependencies = wecomPkg.dependencies ?? {};
    wecomPkg.dependencies["@openclaw-china/shared"] = nextShared;

    wecomAppPkg.version = nextWecomApp;
    wecomAppPkg.private = false;
    wecomAppPkg.dependencies = wecomAppPkg.dependencies ?? {};
    wecomAppPkg.dependencies["@openclaw-china/shared"] = nextShared;

    qqbotPkg.version = nextQqbot;
    qqbotPkg.private = false;
    qqbotPkg.dependencies = qqbotPkg.dependencies ?? {};
    qqbotPkg.dependencies["@openclaw-china/shared"] = nextShared;

    channelsPkg.version = nextChannels;
    channelsPkg.dependencies = channelsPkg.dependencies ?? {};
    channelsPkg.dependencies["@openclaw-china/dingtalk"] = nextDingtalk;
    channelsPkg.dependencies["@openclaw-china/feishu-china"] = nextFeishu;
    channelsPkg.dependencies["@openclaw-china/wecom"] = nextWecom;
    channelsPkg.dependencies["@openclaw-china/wecom-app"] = nextWecomApp;
    channelsPkg.dependencies["@openclaw-china/qqbot"] = nextQqbot;

    writeJson(sharedPath, sharedPkg);
    writeJson(dingtalkPath, dingtalkPkg);
    writeJson(feishuPath, feishuPkg);
    writeJson(wecomPath, wecomPkg);
    writeJson(wecomAppPath, wecomAppPkg);
    writeJson(qqbotPath, qqbotPkg);
    writeJson(channelsPath, channelsPkg);

    run("pnpm -F @openclaw-china/shared build");
    run("pnpm -F @openclaw-china/dingtalk build");
    run("pnpm -F @openclaw-china/feishu-china build");
    run("pnpm -F @openclaw-china/wecom build");
    run("pnpm -F @openclaw-china/wecom-app build");
    run("pnpm -F @openclaw-china/qqbot build");
    run("pnpm -F @openclaw-china/channels build");

    run("npm publish --access public", path.join(root, "packages", "shared"));
    run("npm publish --access public", path.join(root, "extensions", "dingtalk"));
    run("npm publish --access public", path.join(root, "extensions", "feishu"));
    run("npm publish --access public", path.join(root, "extensions", "wecom"));
    run("npm publish --access public", path.join(root, "extensions", "wecom-app"));
    run("npm publish --access public", path.join(root, "extensions", "qqbot"));
    run("npm publish --access public", path.join(root, "packages", "channels"));
  } else {
    if (!channelMap[options.channel]) {
      throw new Error(
        `Unknown channel "${options.channel}". Use one of: ${channelIds.join(", ")}.`
      );
    }

    const target = channelMap[options.channel];
    const targetPkg = target.pkg;
    const targetDir = path.dirname(target.path);

    const latestShared = getLatestPublishedVersion(sharedPkg.name);
    const sharedVersionToUse = options.withShared
      ? getNextVersion(sharedPkg.name, sharedPkg.version)
      : latestShared;

    if (!sharedVersionToUse) {
      throw new Error(
        `${sharedPkg.name} has not been published yet. Use --with-shared or run full release.`
      );
    }

    if (!options.withShared) {
      const localSharedParsed = parseVersion(sharedPkg.version);
      const latestSharedParsed = parseVersion(sharedVersionToUse);
      if (compareVersions(localSharedParsed, latestSharedParsed) > 0) {
        throw new Error(
          `Local ${sharedPkg.name} version (${sharedPkg.version}) is ahead of npm (${sharedVersionToUse}). ` +
            "Use --with-shared or run full release."
        );
      }
    }

    const nextTarget = getNextVersion(targetPkg.name, targetPkg.version);
    const nextChannels = getNextVersion(channelsPkg.name, channelsPkg.version);

    if (options.withShared) {
      sharedPkg.version = sharedVersionToUse;
      sharedPkg.private = false;
      writeJson(sharedPath, sharedPkg);
    }

    targetPkg.version = nextTarget;
    targetPkg.private = false;
    targetPkg.dependencies = targetPkg.dependencies ?? {};
    targetPkg.dependencies["@openclaw-china/shared"] = sharedVersionToUse;

    channelsPkg.version = nextChannels;
    channelsPkg.dependencies = channelsPkg.dependencies ?? {};
    channelsPkg.dependencies[targetPkg.name] = nextTarget;

    writeJson(target.path, targetPkg);
    writeJson(channelsPath, channelsPkg);

    if (options.withShared) {
      run("pnpm -F @openclaw-china/shared build");
    }
    run(`pnpm -F ${targetPkg.name} build`);
    run("pnpm -F @openclaw-china/channels build");

    if (options.withShared) {
      run("npm publish --access public", path.join(root, "packages", "shared"));
    }
    run("npm publish --access public", targetDir);
    run("npm publish --access public", path.join(root, "packages", "channels"));
  }
} finally {
  // Restore workspace dependencies for local development
  if (originalDingtalk.dependencies) {
    originalDingtalk.dependencies["@openclaw-china/shared"] =
      originalDingtalk.dependencies["@openclaw-china/shared"] ?? "workspace:*";
  }
  if (originalFeishu.dependencies) {
    originalFeishu.dependencies["@openclaw-china/shared"] =
      originalFeishu.dependencies["@openclaw-china/shared"] ?? "workspace:*";
  }
  if (originalWecom.dependencies) {
    originalWecom.dependencies["@openclaw-china/shared"] =
      originalWecom.dependencies["@openclaw-china/shared"] ?? "workspace:*";
  }
  if (originalWecomApp.dependencies) {
    originalWecomApp.dependencies["@openclaw-china/shared"] =
      originalWecomApp.dependencies["@openclaw-china/shared"] ?? "workspace:*";
  }
  if (originalQqbot.dependencies) {
    originalQqbot.dependencies["@openclaw-china/shared"] =
      originalQqbot.dependencies["@openclaw-china/shared"] ?? "workspace:*";
  }
  if (originalChannels.dependencies) {
    originalChannels.dependencies["@openclaw-china/dingtalk"] =
      originalChannels.dependencies["@openclaw-china/dingtalk"] ?? "workspace:*";
    originalChannels.dependencies["@openclaw-china/feishu-china"] =
      originalChannels.dependencies["@openclaw-china/feishu-china"] ?? "workspace:*";
    originalChannels.dependencies["@openclaw-china/wecom"] =
      originalChannels.dependencies["@openclaw-china/wecom"] ?? "workspace:*";
    originalChannels.dependencies["@openclaw-china/wecom-app"] =
      originalChannels.dependencies["@openclaw-china/wecom-app"] ?? "workspace:*";
    originalChannels.dependencies["@openclaw-china/qqbot"] =
      originalChannels.dependencies["@openclaw-china/qqbot"] ?? "workspace:*";
  }

  writeJson(sharedPath, originalShared);
  writeJson(dingtalkPath, originalDingtalk);
  writeJson(feishuPath, originalFeishu);
  writeJson(wecomPath, originalWecom);
  writeJson(wecomAppPath, originalWecomApp);
  writeJson(qqbotPath, originalQqbot);
  writeJson(channelsPath, originalChannels);
}
