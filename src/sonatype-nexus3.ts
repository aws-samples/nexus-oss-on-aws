#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SonatypeNexus3Stack } from './lib/sonatype-nexus3-stack';

const app = new cdk.App();
const vpcId = app.node.tryGetContext('vpcId');
const env = vpcId ? {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
} : undefined;

new SonatypeNexus3Stack(app, 'SonatypeNexus3OnEKS', {
  env: env,
});

cdk.Tags.of(app).add('app', 'nexus3');
