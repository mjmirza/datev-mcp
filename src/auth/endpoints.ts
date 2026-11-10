// Verified 2026-11-09 (jwks 2026-11-09) against login.datev.de/<issuer>/.well-known/openid-configuration.
export type DatevEnv = "sandbox" | "production";

export interface Endpoints {
  issuer: string;
  authorize: string;
  token: string;
  revoke: string;
  userinfo: string;
  jwks: string;
}

export const ENDPOINTS: Record<DatevEnv, Endpoints> = {
  sandbox: {
    issuer: "https://login.datev.de/openidsandbox",
    authorize: "https://login.datev.de/openidsandbox/authorize",
    token: "https://sandbox-api.datev.de/token",
    revoke: "https://sandbox-api.datev.de/revoke",
    userinfo: "https://sandbox-api.datev.de/userinfo",
    jwks: "https://sandbox-api.datev.de/certs",
  },
  production: {
    issuer: "https://login.datev.de/openid",
    authorize: "https://login.datev.de/openid/authorize",
    token: "https://api.datev.de/token",
    revoke: "https://api.datev.de/revoke",
    userinfo: "https://api.datev.de/userinfo",
    jwks: "https://api.datev.de/certs",
  },
};

export function parseEnv(value: string | undefined): DatevEnv {
  if (value === undefined || value === "" || value === "sandbox") return "sandbox";
  if (value === "production") return "production";
  throw new Error(`DATEV_ENV must be "sandbox" or "production", got "${value}"`);
}
