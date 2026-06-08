export interface OriginUrlRewriteRule {
  /** Literal substring or regex matched against the full text block. */
  match: string | RegExp;
  replace: string;
}

export interface OriginUrlRewriteConfig {
  rules: OriginUrlRewriteRule[];
}

/** Swap legacy gateway/staging host fragments before parse, fetch, or asset discovery. */
export function rewriteOriginUrlsInText(text: string, config: OriginUrlRewriteConfig): string {
  if (!text || config.rules.length === 0) return text;

  let result = text;
  for (const rule of config.rules) {
    if (typeof rule.match === "string") {
      if (!rule.match) continue;
      result = result.split(rule.match).join(rule.replace);
      continue;
    }
    result = result.replace(rule.match, rule.replace);
  }
  return result;
}

/** Build a rule that rewrites API-gateway `/prod/wp-content/` paths to a public origin. */
export function createWpContentGatewayRewrite(gatewayBase: string, publicOrigin: string): OriginUrlRewriteConfig {
  const normalizedGateway = gatewayBase.replace(/\/$/, "");
  const normalizedPublic = publicOrigin.replace(/\/$/, "");
  return {
    rules: [
      {
        match: `${normalizedGateway}/wp-content/`,
        replace: `${normalizedPublic}/wp-content/`,
      },
    ],
  };
}
