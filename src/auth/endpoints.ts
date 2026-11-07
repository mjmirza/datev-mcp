// Verified 2026-11-07 against login.datev.de/<issuer>/.well-known/openid-configuration.
export type DatevEnv = "sandbox" | "production";

export interface Endpoints {
  issuer: string;
  authorize: string;
  token: string;
  revoke: string;
  userinfo: string;
}

export const ENDPOINTS: Record<DatevEnv, Endpoints> = {
  sandbox: {
    issuer: "https://login.datev.de/openidsandbox",
    authorize: "https://login.datev.de/openidsandbox/authorize",
    token: "https://sandbox-api.datev.de/token",
    revoke: "https://sandbox-api.datev.de/revoke",
    userinfo: "https://sandbox-api.datev.de/userinfo",
  },
  production: {
    issuer: "https://login.datev.de/openid",
    authorize: "https://login.datev.de/openid/authorize",
    token: "https://api.datev.de/token",
    revoke: "https://api.datev.de/revoke",
    userinfo: "https://api.datev.de/userinfo",
  },
};

export function parseEnv(value: string | undefined): DatevEnv {
  if (value === undefined || value === "" || value === "sandbox") return "sandbox";
  if (value === "production") return "production";
  throw new Error(`DATEV_ENV must be "sandbox" or "production", got "${value}"`);
}
