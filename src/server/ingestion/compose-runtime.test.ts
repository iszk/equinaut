import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readProjectFile = (path: string): string => readFileSync(resolve(projectRoot, path), "utf8");

const nonEmptyLines = (value: string): string[] =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "");

const composeServiceSchema = z
  .object({
    restart: z.string().optional(),
    image: z.string().optional(),
    build: z.object({ context: z.string() }).optional(),
    command: z.array(z.string()).optional(),
    environment: z.array(z.string()).optional(),
    init: z.boolean().optional(),
    depends_on: z.record(z.string(), z.object({ condition: z.string() })).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    secrets: z.array(z.string()).optional(),
    volumes: z.array(z.unknown()).optional(),
    profiles: z.array(z.string()).optional(),
  })
  .passthrough();

const composeSchema = z
  .object({
    services: z.record(z.string(), composeServiceSchema),
    secrets: z.record(z.string(), z.object({ file: z.string() })).optional(),
  })
  .passthrough();

const readComposeConfig = (): z.infer<typeof composeSchema> => {
  const parsed: unknown = parse(readProjectFile("compose.yml.sample"));
  return composeSchema.parse(parsed);
};

const expectedSecretNames = [
  "bitbank_api_key",
  "bitbank_api_secret",
  "bitflyer_api_key",
  "bitflyer_api_secret",
  "saxo_portfolio_api_secret",
];

const expectedJobs = [
  {
    name: "equinaut-bitbank-ingestion",
    schedule: "0 0,15,30,45 * * * *",
    command: "/usr/bin/timeout --signal=TERM --kill-after=30s 10m npm run ingest -- bitbank",
  },
  {
    name: "equinaut-bitflyer-ingestion",
    schedule: "0 5,20,35,50 * * * *",
    command: "/usr/bin/timeout --signal=TERM --kill-after=30s 10m npm run ingest -- bitflyer",
  },
  {
    name: "equinaut-saxo-ingestion",
    schedule: "0 10,25,40,55 * * * *",
    command: "/usr/bin/timeout --signal=TERM --kill-after=30s 10m npm run ingest -- saxo",
  },
];

describe("Compose runtime configuration", () => {
  it("excludes local secret files from Git and the Docker build context", () => {
    expect(nonEmptyLines(readProjectFile(".gitignore"))).toContain("secrets/");
    expect(nonEmptyLines(readProjectFile(".dockerignore"))).toContain("secrets/");
  });

  it("documents the file-mounted secret contract without secret values", () => {
    const envExample = readProjectFile(".env.example");

    expect(envExample).toContain("EQUINAUT_SECRETS_DIR=./secrets");
    expect(envExample).toContain("bitbank_api_key");
    expect(envExample).toContain("bitbank_api_secret");
    expect(envExample).toContain("bitflyer_api_key");
    expect(envExample).toContain("bitflyer_api_secret");
    expect(envExample).toContain("saxo_portfolio_api_secret");
  });

  it("defines a dedicated ingestion worker without source bind mounts", () => {
    const config = readComposeConfig();
    const worker = config.services["ingestion-worker"];

    expect(worker, "ingestion-worker service").toBeDefined();
    if (worker === undefined) {
      return;
    }

    expect(config.services.scheduler).toBeUndefined();
    expect(config.services.ofelia).toBeUndefined();
    expect(worker).toMatchObject({
      restart: "unless-stopped",
      image: "equinaut-ingestion:local",
      build: { context: "." },
      command: ["sleep", "infinity"],
      init: true,
      depends_on: { postgres: { condition: "service_healthy" } },
      secrets: expect.arrayContaining(expectedSecretNames),
    });
    expect(worker.secrets).toHaveLength(expectedSecretNames.length);
    expect(worker.volumes).toBeUndefined();
  });

  it("mounts the five credential files through Compose secrets", () => {
    const config = readComposeConfig();
    const expectedSecrets = Object.fromEntries(
      expectedSecretNames.map((name) => [name, { file: `\${EQUINAUT_SECRETS_DIR:-./secrets}/${name}` }]),
    );

    expect(config.secrets).toEqual(expectedSecrets);

    const environment = config.services["ingestion-worker"]?.environment ?? [];
    expect(environment).toEqual(
      expect.arrayContaining([
        "BITBANK_API_KEY_FILE=/run/secrets/bitbank_api_key",
        "BITBANK_API_SECRET_FILE=/run/secrets/bitbank_api_secret",
        "BITFLYER_API_KEY_FILE=/run/secrets/bitflyer_api_key",
        "BITFLYER_API_SECRET_FILE=/run/secrets/bitflyer_api_secret",
        "SAXO_PORTFOLIO_API_SECRET_FILE=/run/secrets/saxo_portfolio_api_secret",
      ]),
    );
    expect(environment.join("\n")).not.toMatch(/(?:API_KEY|API_SECRET|TOKEN|PASSWORD)=\$\{/iu);
  });

  it("defines three globally unique, staggered, non-overlapping Ofelia jobs", () => {
    const labels = readComposeConfig().services["ingestion-worker"]?.labels;

    expect(labels, "ingestion-worker labels").toBeDefined();
    if (labels === undefined) {
      return;
    }

    expect(labels["ofelia.enabled"]).toBe("true");
    for (const job of expectedJobs) {
      const prefix = `ofelia.job-exec.${job.name}`;
      expect(labels[`${prefix}.schedule`]).toBe(job.schedule);
      expect(labels[`${prefix}.command`]).toBe(job.command);
      expect(labels[`${prefix}.no-overlap`]).toBe("true");
      expect(labels[`${prefix}.user`]).toBe("node");
    }

    expect(JSON.stringify(labels)).not.toMatch(
      /DATABASE_URL|POSTGRES_PASSWORD|API_KEY|API_SECRET|AUTHORIZATION|COOKIE|TOKEN/iu,
    );
  });

  it("separates database migration into an explicitly targeted one-shot service", () => {
    const config = readComposeConfig();
    const worker = config.services["ingestion-worker"];
    const migration = config.services.migration;

    expect(migration, "migration service").toBeDefined();
    if (migration === undefined) {
      return;
    }

    expect(migration).toMatchObject({
      restart: "no",
      image: "equinaut-ingestion:local",
      build: { context: "." },
      command: ["npm", "run", "db:migrate"],
      profiles: ["tools"],
      depends_on: { postgres: { condition: "service_healthy" } },
    });
    expect(migration.environment).toEqual(
      expect.arrayContaining(["TZ=Asia/Tokyo", "LANG=C.UTF-8", expect.stringMatching(/^DATABASE_URL=/u)]),
    );
    expect(migration.labels).toBeUndefined();
    expect(migration.secrets).toBeUndefined();
    expect(worker?.depends_on?.migration).toBeUndefined();
  });

  it("builds dependencies once and has a migration-free worker image default", () => {
    const dockerfile = readProjectFile("Dockerfile");
    const commands = nonEmptyLines(dockerfile).filter((line) => line.startsWith("CMD "));

    expect(dockerfile).toContain("RUN npm ci");
    expect(dockerfile).toContain("RUN /usr/bin/timeout --version >/dev/null");
    expect(dockerfile).toContain("USER node");
    expect(commands).toEqual(['CMD ["sleep", "infinity"]']);
  });
});
