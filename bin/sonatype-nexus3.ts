#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { SonatypeNexus3Stack } from '../lib/sonatype-nexus3-stack';

const app = new cdk.App();
const env = app.node.tryGetContext('createNewVpc') ? undefined : {
    region: process.env.CDK_DEFAULT_REGION,
    account: process.env.CDK_DEFAULT_ACCOUNT,
};
new SonatypeNexus3Stack(app, 'SonatypeNexus3OnEKS', {
    env: env,
});

cdk.Tags.of(app).add('app', 'nexus3');
