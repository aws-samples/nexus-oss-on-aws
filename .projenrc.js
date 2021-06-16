const { AwsCdkTypeScriptApp } = require('projen');
const project = new AwsCdkTypeScriptApp({
  cdkVersion: '1.108.0',
  defaultReleaseBranch: 'master',
  name: 'sonatype-nexus3',
  appEntrypoint: 'sonatype-nexus3.ts',
  cdkVersionPinning: true,
  cdkDependencies: [
    '@aws-cdk/aws-certificatemanager',
    '@aws-cdk/aws-ec2',
    '@aws-cdk/aws-efs',
    '@aws-cdk/aws-eks',
    '@aws-cdk/aws-iam',
    '@aws-cdk/aws-lambda',
    '@aws-cdk/aws-lambda-python',
    '@aws-cdk/aws-logs',
    '@aws-cdk/aws-s3',
    '@aws-cdk/aws-route53',
    '@aws-cdk/lambda-layer-awscli',
    '@aws-cdk/lambda-layer-kubectl',
    '@aws-cdk/cloud-assembly-schema',
    '@aws-cdk/cx-api',
  ], /* Which AWS CDK modules (those that start with "@aws-cdk/") this app uses. */
  deps: [
    'js-yaml@^3.14.1',
    'sync-request@^6.1.0',
  ], /* Runtime dependencies of this module. */
  // description: undefined,            /* The description is just a string that helps people understand the purpose of the package. */
  devDeps: [
    'lodash@>=4.17.21',
  ], /* Build dependencies for this module. */
  // packageName: undefined,            /* The "name" in package.json. */
  // projectType: ProjectType.UNKNOWN,  /* Which type of project this is (library/app). */
  // releaseWorkflow: undefined,        /* Define a GitHub workflow for releasing from "main" when new versions are bumped. */
  pullRequestTemplate: true /* Include a GitHub pull request template. */,
  pullRequestTemplateContents: [
    '*Issue #, if available:*',
    '',
    '*Description of changes:*',
    '',
    '',
    'By submitting this pull request, I confirm that you can use, modify, copy, and redistribute this contribution, under the terms of your choice.',
  ],
  license: 'MIT-0' /* License's SPDX identifier. */,
  licensed: false /* Indicates if a license should be added. */,
  gitignore: [
    '.idea/',
    '.vscode/',
    'cdk.context.json',
    '.DS_Store',
  ],
  keywords: [
    'aws',
    'sonatype',
    'nexus3',
    'aws-cdk',
    'aws-eks',
    'eks',
  ],
});
// tricky to override the default synth task
project.tasks._tasks.synth._steps[0] = {
  exec: 'cdk synth -c createNewVpc=true',
};
project.addFields({
  version: '1.2.0-mainline',
});
project.synth();