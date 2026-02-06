import { z } from "zod";

const optionalCoercedString = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    const next = String(value).trim();
    return next;
  },
  z.string().min(1).optional()
);

export const QQBotConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  appId: optionalCoercedString,
  clientSecret: optionalCoercedString,
  markdownSupport: z.boolean().optional().default(false),
  dmPolicy: z.enum(["open", "pairing", "allowlist"]).optional().default("open"),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional().default("open"),
  requireMention: z.boolean().optional().default(true),
  allowFrom: z.array(z.string()).optional(),
  groupAllowFrom: z.array(z.string()).optional(),
  historyLimit: z.number().int().min(0).optional().default(10),
  textChunkLimit: z.number().int().positive().optional().default(1500),
  replyFinalOnly: z.boolean().optional().default(false),
  maxFileSizeMB: z.number().positive().optional().default(100),
  mediaTimeoutMs: z.number().int().positive().optional().default(30000),
});

export type QQBotConfig = z.infer<typeof QQBotConfigSchema>;

export function isConfigured(config: QQBotConfig | undefined): boolean {
  return Boolean(config?.appId && config?.clientSecret);
}

export function resolveQQBotCredentials(
  config: QQBotConfig | undefined
): { appId: string; clientSecret: string } | undefined {
  if (!config?.appId || !config?.clientSecret) return undefined;
  return { appId: config.appId, clientSecret: config.clientSecret };
}
