import * as cdk from 'aws-cdk-lib';
import { VazueQueue } from '@vazue/queue-cdk';

const app = new cdk.App();
const stack = new cdk.Stack(app, 'VazueQueueExample', {
  env: { region: 'us-east-1' },
});
new VazueQueue(stack, 'Queue', {
  domainName: 'queue.example.com',
  preset: 'standard',
  awsRegion: 'us-east-1',
  security: { botProtection: { mode: 'off' } },
});
