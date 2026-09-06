import { loadEnvConfig } from "@next/env";
import { encode } from "@auth/core/jwt";

loadEnvConfig(process.cwd());

const secret = process.env.AUTH_SECRET?.trim();
if (!secret) {
  console.error("AUTH_SECRET is missing. Load .env.local or export AUTH_SECRET before minting an E2E cookie.");
  process.exit(1);
}

const ownerId = process.env.STACK_STRUCTURE_E2E_USER_ID?.trim() || "github-e2e-local";
const login = process.env.STACK_STRUCTURE_E2E_LOGIN?.trim() || "e2e-local";

const token = await encode({
  token: {
    sub: ownerId,
    ownerId,
    login,
    name: login,
  },
  secret,
  salt: "authjs.session-token",
});

process.stdout.write(`authjs.session-token=${token}`);
