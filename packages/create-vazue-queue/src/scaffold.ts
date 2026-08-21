import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { QueueCliConfig } from './config.js';

/** Scaffold a self-hosted CDK app that writes vazue-queue.config.json. */
export function writeProject(dir: string, cfg: QueueCliConfig) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(
    join(dir, 'vazue-queue.config.json'),
    JSON.stringify({ $schema: 'https://unpkg.com/@vazue/queue-cdk/config-schema.json', ...cfg }, null, 2) +
      '\n',
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
    JSON.stringify({ app: 'npx ts-node --esm bin/app.ts', context: { 'vazue-queue': cfg } }, null, 2) +
      '\n',
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
