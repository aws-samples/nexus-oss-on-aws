const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.37.1',
  defaultReleaseBranch: 'master',
  name: 'sonatype-nexus3',
  appEntrypoint: 'sonatype-nexus3.ts',
  cdkVersionPinning: true,
  deps: [
    'js-yaml@^3.14.1',
    'sync-request@^6.1.0',
  ], /* Runtime dependencies of this module. */
  // description: undefined,            /* The description is just a string that helps people understand the purpose of the package. */
  devDeps: [
    'lodash@>=4.17.21',
  ], /* Build dependencies for this module. */
  typescriptVersion: '~4.6.0', /* TypeScript version to use. */
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
  depsUpgradeOptions: {
    ignoreProjen: false,
    workflowOptions: {
      labels: ['auto-approve', 'auto-merge'],
      secret: 'PROJEN_GITHUB_TOKEN',
    },
  },
});
// tricky to override the default synth task
project.tasks._tasks.synth._steps[0] = {
  exec: 'cdk synth -c createNewVpc=true',
};
// project.package.addField('resolutions',
//   Object.assign({}, project.package.manifest.resolutions ? project.package.manifest.resolutions : {}, {
//     'pac-resolver': '^5.0.0',
//     'set-value': '^4.0.1',
//     'ansi-regex': '^5.0.1',
//   })
// );
project.addFields({
  version: '1.3.0-mainline',
});
project.synth();