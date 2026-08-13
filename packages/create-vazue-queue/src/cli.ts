#!/usr/bin/env node
import * as p from '@clack/prompts';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { validateQueueCliConfig, type QueueCliConfig } from './config.js';
import { estimateOssEventCost, formatCostReport } from './cost.js';

type Config = QueueCliConfig;

function parseArgs(argv: string[]) {
  const args = { yes: false, dir: 'my-queue', domain: '', preset: 'standard' as Config['preset'], show: false, validate: false, configOnly: false };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--domain') args.domain = argv[++i] ?? '';
    else if (a === '--preset') args.preset = (argv[++i] as Config['preset']) ?? 'standard';
    else if (a === 'config') args.configOnly = true;
    else if (a === '--show') args.show = true;
    else if (a === '--validate') args.validate = true;
    else if (!a.startsWith('-')) positional.push(a);
  }
  if (positional[0] && positional[0] !== 'config') args.dir = positional[0];
  return args;
}

async function wizard(defaults?: Partial<Config>): Promise<Config> {
  p.intro('Vazue Queue setup');
  const preset = (await p.select({
    message: 'Preset',
    options: [
      { value: 'minimal', label: 'minimal — API only' },
      { value: 'standard', label: 'standard — waiting room (recommended)' },
      { value: 'full', label: 'full — admin + WAF' },
    ],
    initialValue: defaults?.preset ?? 'standard',
  })) as Config['preset'];
  if (p.isCancel(preset)) process.exit(0);

  const domainName = await p.text({
    message: 'Domain name',
    placeholder: 'queue.example.com',
    initialValue: defaults?.domainName ?? '',
    validate: (v) => (!v || v.length < 3 ? 'Required' : undefined),
  });
  if (p.isCancel(domainName)) process.exit(0);

  const awsRegion = await p.text({
    message: 'AWS region',
    initialValue: defaults?.awsRegion ?? 'us-east-1',
  });
  if (p.isCancel(awsRegion)) process.exit(0);

  const hasZone = await p.confirm({
    message: 'Do you have a Route 53 hosted zone to auto-create DNS?',
    initialValue: false,
  });
  if (p.isCancel(hasZone)) process.exit(0);

  let dns: Config['dns'];
  if (hasZone) {
    const hostedZoneId = await p.text({ message: 'Hosted zone ID (optional)', initialValue: '' });
    if (p.isCancel(hostedZoneId)) process.exit(0);
    const hostedZoneName = await p.text({ message: 'Hosted zone name (optional)', initialValue: '' });
    if (p.isCancel(hostedZoneName)) process.exit(0);
    dns = {
      ...(hostedZoneId ? { hostedZoneId: String(hostedZoneId) } : {}),
      ...(hostedZoneName ? { hostedZoneName: String(hostedZoneName) } : {}),
    };
  }

  const throughput = await p.text({
    message: 'Default admits per minute',
    initialValue: String(defaults?.queue?.defaultThroughputPerMinute ?? 100),
  });
  if (p.isCancel(throughput)) process.exit(0);

  const botMode = (await p.select({
    message: 'Bot protection',
    options: [
      { value: 'off', label: 'off (default)' },
      { value: 'rate_limit_only', label: 'rate_limit_only' },
      { value: 'challenge_suspicious', label: 'challenge_suspicious' },
      { value: 'challenge_always', label: 'challenge_always' },
    ],
    initialValue: defaults?.security?.botProtection?.mode ?? 'off',
  })) as string;
  if (p.isCancel(botMode)) process.exit(0);

  let turnstileSiteKey: string | undefined;
  if (botMode !== 'off' && botMode !== 'rate_limit_only') {
    const key = await p.text({ message: 'Turnstile site key (or leave empty)', initialValue: '' });
    if (p.isCancel(key)) process.exit(0);
    if (key) turnstileSiteKey = String(key);
  }

  const brandName = await p.text({
    message: 'Waiting room brand name',
    initialValue: defaults?.waitingRoom?.brandName ?? 'Vazue Queue',
  });
  if (p.isCancel(brandName)) process.exit(0);
  const waitingMessage = await p.text({
    message: 'Waiting room visitor message',
    initialValue:
      defaults?.waitingRoom?.message ?? "You're in line. Please keep this tab open.",
  });
  if (p.isCancel(waitingMessage)) process.exit(0);

  const cfg: Config = {
    domainName: String(domainName),
    preset,
    awsRegion: String(awsRegion),
    ...(dns && Object.keys(dns).length ? { dns } : {}),
    queue: { defaultThroughputPerMinute: Number(throughput) || 100 },
    security: {
      botProtection: {
        mode: botMode,
        ...(turnstileSiteKey ? { turnstileSiteKey } : {}),
      },
    },
    waitingRoom: {
      brandName: String(brandName),
      message: String(waitingMessage),
    },
  };

  p.note(
    JSON.stringify(cfg, null, 2),
    'Config summary',
  );
  const ok = await p.confirm({ message: 'Write vazue-queue.config.json?', initialValue: true });
  if (p.isCancel(ok) || !ok) {
    p.cancel('Aborted');
    process.exit(0);
  }
  p.outro('Done');
  return cfg;
}

function writeProject(dir: string, cfg: Config) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(
    join(dir, 'vazue-queue.config.json'),
    JSON.stringify({ $schema: 'https://unpkg.com/@vazue/queue-cdk/config-schema.json', ...cfg }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'vazue-queue-app',
        private: true,
        scripts: {
          build: 'tsc',
          deploy: 'pnpm test:local --if-present; cdk deploy --require-approval never',
          'test:local': 'echo "run monorepo pnpm test:local from vazue-queue root"',
        },
        dependencies: {
          '@vazue/queue-cdk': 'workspace:*',
          'aws-cdk-lib': '^2.208.0',
          constructs: '^10.4.2',
        },
        devDependencies: {
          'aws-cdk': '^2.208.0',
          typescript: '^5.9.2',
          '@types/node': '^24.2.0',
        },
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    join(dir, 'cdk.json'),
    JSON.stringify({ app: 'npx ts-node --esm bin/app.ts', context: { 'vazue-queue': cfg } }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'bin/app.ts'),
    `import * as cdk from 'aws-cdk-lib';
import { VazueQueue } from '@vazue/queue-cdk';
import { readFileSync } from 'node:fs';

const app = new cdk.App();
const cfg = JSON.parse(readFileSync(new URL('../vazue-queue.config.json', import.meta.url), 'utf8'));
const stack = new cdk.Stack(app, 'VazueQueueStack', {
  env: { region: cfg.awsRegion ?? 'us-east-1' },
});
new VazueQueue(stack, 'Queue', cfg);
app.synth();
`,
  );
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['bin/**/*.ts'],
      },
      null,
      2,
    ) + '\n',
  );
}

function validateFile(path: string) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  try {
    validateQueueCliConfig(raw);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
  console.log('Config valid:', path);
}

function parseCostArgs(argv: string[]) {
  let visitors = 100_000;
  let minutes = 60;
  let poll = 5;
  let throughput = 100;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--visitors') visitors = Number(argv[++i] ?? visitors);
    else if (a === '--minutes') minutes = Number(argv[++i] ?? minutes);
    else if (a === '--poll') poll = Number(argv[++i] ?? poll);
    else if (a === '--throughput') throughput = Number(argv[++i] ?? throughput);
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: vazue-queue cost --visitors 100000 --minutes 60 [--poll 5] [--throughput 100]',
      );
      process.exit(0);
    }
  }
  return { visitors, durationMinutes: minutes, pollSeconds: poll, throughputPerMinute: throughput };
}

async function main() {
  if (process.argv[2] === 'cost') {
    const est = estimateOssEventCost(parseCostArgs(process.argv.slice(3)));
    console.log(formatCostReport(est));
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  if (args.configOnly) {
    const configPath = resolve(cwd, 'vazue-queue.config.json');
    if (args.show) {
      if (!existsSync(configPath)) {
        console.error('No vazue-queue.config.json');
        process.exit(1);
      }
      console.log(readFileSync(configPath, 'utf8'));
      return;
    }
    if (args.validate) {
      validateFile(configPath);
      return;
    }
    const existing = existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, 'utf8')) as Config)
      : undefined;
    const cfg = args.yes
      ? {
          domainName: args.domain || existing?.domainName || 'queue.example.com',
          preset: args.preset,
          awsRegion: existing?.awsRegion ?? 'us-east-1',
        }
      : await wizard(existing);
    writeFileSync(
      configPath,
      JSON.stringify({ $schema: 'https://unpkg.com/@vazue/queue-cdk/config-schema.json', ...cfg }, null, 2) + '\n',
    );
    console.log('Wrote', configPath);
    return;
  }

  const dir = resolve(cwd, args.dir);
  const cfg = args.yes
    ? {
        domainName: args.domain || 'queue.example.com',
        preset: args.preset,
        awsRegion: 'us-east-1',
        security: { botProtection: { mode: 'off' } },
        queue: { defaultThroughputPerMinute: 100 },
      }
    : await wizard();
  writeProject(dir, cfg);
  console.log(`Created ${dir}`);
  console.log('Next: cd', args.dir, '&& pnpm install && npx cdk bootstrap && npm run deploy');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
