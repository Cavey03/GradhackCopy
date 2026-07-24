#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { InfraStack } from '../lib/infra-stack';

const app = new cdk.App();
new InfraStack(app, 'RecoveryPlatformStack', {
  env: { account: '435614981173', region: 'eu-central-1' },
});