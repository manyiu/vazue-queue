import * as cdk from 'aws-cdk-lib';
import { VazueQueueApp } from '@yiu/queue-cdk';

const app = new cdk.App();
VazueQueueApp.fromContext(app, 'VazueQueueLoadTestRc');
