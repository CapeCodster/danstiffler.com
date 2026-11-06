import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = path.join(projectRoot, "trip", "private");
const projectName = "danstiffler-com";
const environment = process.env.TRIP_DEPLOYMENT_ENV || "preview";
if (!["preview", "production"].includes(environment)) {
  throw new Error("TRIP_DEPLOYMENT_ENV must be preview or production");
}
const environmentLabel = environment === "production" ? "Production" : "Preview";
const statePath = path.join(privateRoot, `${environment}-setup-state.json`);
const secretEnvironmentArgs = environment === "preview" ? ["--env", "preview"] : [];

function randomSecret() {
  return crypto.randomBytes(48).toString("base64url");
}

function randomAccessCode(excluded) {
  while (true) {
    const value = String(crypto.randomInt(100000, 1000000));
    if (!excluded.has(value)) return value;
  }
}

async function loadOrCreateState() {
  try {
    const existing = JSON.parse(await fs.readFile(statePath, "utf8"));
    if (!existing.authPepper || !existing.bootstrapSecret || !existing.accessCodes?.Dan || !existing.accessCodes?.Ken) {
      throw new Error(`The existing private ${environmentLabel} setup state is incomplete`);
    }
    return existing;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const excluded = new Set(["111111", "222222"]);
  const danCode = randomAccessCode(excluded);
  excluded.add(danCode);
  const state = {
    createdAt: new Date().toISOString(),
    authPepper: randomSecret(),
    bootstrapSecret: randomSecret(),
    accessCodes: {
      Dan: danCode,
      Ken: randomAccessCode(excluded),
    },
  };
  await fs.mkdir(privateRoot, { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(statePath, 0o600);
  return state;
}

function putDeploymentSecret(name, value) {
  const result = spawnSync(
    "npx",
    ["wrangler", "pages", "secret", "put", name, "--project-name", projectName, ...secretEnvironmentArgs],
    {
      cwd: projectRoot,
      env: { ...process.env, WRANGLER_LOG_PATH: `/private/tmp/danstiffler-${name.toLowerCase()}-${environment}.log` },
      input: `${value}\n`,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    throw new Error(`Unable to configure ${environmentLabel} secret ${name}: ${result.stderr || result.stdout}`);
  }
  console.log(JSON.stringify({ secret: name, environment, configured: true }));
}

const state = await loadOrCreateState();
if (state.accessCodes.Dan === "111111" || state.accessCodes.Ken === "222222") {
  throw new Error(`Localhost test codes are forbidden for ${environmentLabel}`);
}
putDeploymentSecret("AUTH_PEPPER", state.authPepper);
putDeploymentSecret("TRIP_BOOTSTRAP_SECRET", state.bootstrapSecret);
console.log(JSON.stringify({ prepared: true, environment, privateState: `trip/private/${environment}-setup-state.json` }));
