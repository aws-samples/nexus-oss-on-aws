/* eslint @typescript-eslint/no-require-imports: "off" */
import * as path from 'path';
import * as certmgr from '@aws-cdk/aws-certificatemanager';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as eks from '@aws-cdk/aws-eks';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambda_python from '@aws-cdk/aws-lambda-python';
import * as logs from '@aws-cdk/aws-logs';
import * as route53 from '@aws-cdk/aws-route53';
import * as s3 from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
} from '@aws-cdk/custom-resources';
import { AwsCliLayer } from '@aws-cdk/lambda-layer-awscli';
import { KubectlLayer } from '@aws-cdk/lambda-layer-kubectl';
import * as pjson from '../../package.json';
const assert = require('assert').strict;

export class SonatypeNexus3Stack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const targetRegion = this.node.tryGetContext('region') ?? 'us-east-1';

    const partitionMapping = new cdk.CfnMapping(this, 'PartitionMapping', {
      mapping: {
        'aws': {
          nexus: 'quay.io/travelaudience/docker-nexus',
          nexusProxy: 'quay.io/travelaudience/docker-nexus-proxy',
          albHelmChartRepo: 'https://aws.github.io/eks-charts',
          efsCSIHelmChartRepo: 'https://kubernetes-sigs.github.io/aws-efs-csi-driver/',
          nexusHelmChartRepo: 'https://oteemo.github.io/charts/',
        },
        'aws-cn': {
          nexus: '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/quay/travelaudience/docker-nexus',
          nexusProxy: '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/quay/travelaudience/docker-nexus-proxy',
          albHelmChartRepo: 'https://aws-gcr-solutions-assets.s3.cn-northwest-1.amazonaws.com.cn/helm/charts/eks-charts/',
          efsCSIHelmChartRepo: 'https://aws-gcr-solutions-assets.s3.cn-northwest-1.amazonaws.com.cn/helm/charts/aws-efs-csi-driver/',
          nexusHelmChartRepo: 'https://aws-gcr-solutions-assets.s3.cn-northwest-1.amazonaws.com.cn/helm/charts/oteemo/',
        },
      },
    });

    const constraintDescription = '- at least 8 characters\n- must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number\n- Can contain special characters';
    const adminInitPassword = new cdk.CfnParameter(this, 'NexusAdminInitPassword', {
      type: 'String',
      allowedPattern: '^(?=.*\\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z]).{8,}$',
      minLength: 8,
      description: `The admin init password of Nexus3. ${constraintDescription}`,
      constraintDescription,
      noEcho: true,
    });
    var hostedZone = null;
    var certificate: certmgr.Certificate | undefined;
    var domainName: string | undefined;

    const internalALB = (/true/i).test(this.node.tryGetContext('internalALB'));
    const r53Domain = internalALB ? undefined : this.node.tryGetContext('r53Domain');

    if (!internalALB) {
      const domainNameParameter = new cdk.CfnParameter(this, 'DomainName', {
        type: 'String',
        allowedPattern: '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]',
        description: 'The domain name of Nexus OSS deployment, such as mydomain.com.',
        constraintDescription: 'validate domain name without protocol',
      });
      domainName = domainNameParameter.valueAsString;
      if (r53Domain) {
        hostedZone = route53.HostedZone.fromLookup(this, 'R53HostedZone', {
          domainName: r53Domain,
          privateZone: false,
        });
        assert.ok(hostedZone != null, 'Can not find your hosted zone.');
        certificate = new certmgr.Certificate(this, 'SSLCertificate', {
          domainName: domainName,
          validation: certmgr.CertificateValidation.fromDns(hostedZone),
        });
      } else if ((/true/i).test(this.node.tryGetContext('enableR53HostedZone'))) {
        const r53HostedZoneIdParameter = new cdk.CfnParameter(this, 'R53HostedZoneId', {
          type: 'AWS::Route53::HostedZone::Id',
          description: 'The hosted zone ID of given domain name in Route 53.',
        });
        hostedZone = route53.HostedZone.fromHostedZoneId(this, 'ImportedHostedZone', r53HostedZoneIdParameter.valueAsString);
        certificate = new certmgr.Certificate(this, 'SSLCertificate', {
          domainName: domainName,
          validation: certmgr.CertificateValidation.fromDns(hostedZone),
        });
      }
    }

    const logBucket = new s3.Bucket(this, 'LogBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      serverAccessLogsPrefix: 'logBucketAccessLog',
    });

    const vpcId = this.node.tryGetContext('vpcId');
    const vpc = vpcId ? ec2.Vpc.fromLookup(this, 'NexusOSSVpc', {
      vpcId: vpcId === 'default' ? undefined : vpcId,
      isDefault: vpcId === 'default' ? true : undefined,
    }) : (() => {
      const newVpc = new ec2.Vpc(this, 'NexusOSSVpc', {
        maxAzs: 2,
      });
      const flowLogPrefix = 'vpcFlowLogs';
      newVpc.addFlowLog('VpcFlowlogs', {
        destination: ec2.FlowLogDestination.toS3(logBucket, flowLogPrefix),
      });
      // https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-s3.html#flow-logs-s3-permissions
      logBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AWSLogDeliveryWrite',
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [logBucket.arnForObjects(`${flowLogPrefix}/AWSLogs/${cdk.Aws.ACCOUNT_ID}/*`)],
        conditions: {
          StringEquals: {
            's3:x-amz-acl': 'bucket-owner-full-control',
          },
        },
      }));
      logBucket.addToResourcePolicy(new iam.PolicyStatement({
        sid: 'AWSLogDeliveryCheck',
        principals: [new iam.ServicePrincipal('delivery.logs.amazonaws.com')],
        actions: [
          's3:GetBucketAcl',
          's3:ListBucket',
        ],
        resources: [logBucket.bucketArn],
      }));
      return newVpc;
    })();
    if (this.azOfSubnets(vpc.publicSubnets) <= 1 ||
      this.azOfSubnets(vpc.privateSubnets) <= 1) {
      throw new Error(`VPC '${vpc.vpcId}' must have both public and private subnets cross two AZs at least.`);
    }

    const request = require('sync-request');
    const yaml = require('js-yaml');

    const importedEks = this.node.tryGetContext('importedEKS') ?? false;
    var cluster: eks.ICluster;
    var nodeGroup: eks.Nodegroup;
    var eksVersion: cdk.CfnParameter;

    const nexusBlobBucket = new s3.Bucket(this, 'nexus3-blobstore', {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      serverAccessLogsBucket: logBucket,
      serverAccessLogsPrefix: 'blobstoreBucketAccessLog',
      enforceSSL: true,
    });
    if (vpc instanceof ec2.Vpc) {
      const gatewayEndpoint = vpc.addGatewayEndpoint('s3', {
        service: ec2.GatewayVpcEndpointAwsService.S3,
      });
      nexusBlobBucket.addToResourcePolicy(new iam.PolicyStatement({
        effect: iam.Effect.DENY,
        actions: ['s3:*'],
        principals: [new iam.AccountPrincipal(cdk.Aws.ACCOUNT_ID)],
        resources: [
          nexusBlobBucket.bucketArn,
          nexusBlobBucket.arnForObjects('*'),
        ],
        conditions: {
          StringNotEquals: {
            'aws:SourceVpce': gatewayEndpoint.vpcEndpointId,
          },
        },
      }));
    }
    const s3BucketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListBucket',
      ],
      resources: [nexusBlobBucket.bucketArn],
    });
    const s3ObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetBucketAcl',
        's3:PutObject',
        's3:GetObject',
        's3:DeleteObject',
        's3:PutObjectTagging',
        's3:GetObjectTagging',
        's3:DeleteObjectTagging',
        's3:GetLifecycleConfiguration',
        's3:PutLifecycleConfiguration',
      ],
      resources: [
        nexusBlobBucket.bucketArn,
        nexusBlobBucket.arnForObjects('*'),
      ],
    });

    if (importedEks) {
      if (!vpcId) {throw new Error('Context variable "vpcId" must be specified for imported EKS cluster.');}

      const clusterName = this.node.tryGetContext('eksClusterName');
      const kubectlRoleArn = this.node.tryGetContext('eksKubectlRoleArn');
      const openIdConnectProviderArn = this.node.tryGetContext('eksOpenIdConnectProviderArn');
      const nodeGroupRoleArn = this.node.tryGetContext('nodeGroupRoleArn');

      if (!clusterName || !kubectlRoleArn || !openIdConnectProviderArn || !nodeGroupRoleArn) {throw new Error('Context variables "eksClusterName", "eksKubectlRoleArn", "eksOpenIdConnectProviderArn", "nodeGroupRoleArn" must be specified for imported EKS cluster.');}

      cluster = eks.Cluster.fromClusterAttributes(this, 'ImportedEKS', {
        clusterName,
        kubectlRoleArn,
        openIdConnectProvider: eks.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this, 'ImportedClusterOpendIdConnectProvider', openIdConnectProviderArn),
        vpc,
      });
      // the limitation of Nexus3 image not working with IRSA
      const nodeGroupRole = iam.Role.fromRoleArn(this, 'NodeGroupRole', nodeGroupRoleArn, {
        mutable: true,
      });
      nodeGroupRole.attachInlinePolicy(new iam.Policy(this, 'NexusS3BlobStore', {
        statements: [s3BucketPolicy, s3ObjectPolicy],
      }));
    } else {
      const clusterAdmin = new iam.Role(this, 'AdminRole', {
        assumedBy: new iam.AccountRootPrincipal(),
      });

      const isFargetEnabled = (this.node.tryGetContext('enableFarget') || 'false').toLowerCase() === 'true';

      eksVersion = new cdk.CfnParameter(this, 'KubernetesVersion', {
        type: 'String',
        allowedValues: [
          '1.22',
          '1.21',
          '1.20',
          '1.19'
        ],
        default: '1.20',
        description: 'The version of Kubernetes.',
      });

      cluster = new eks.Cluster(this, 'NexusCluster', {
        vpc,
        endpointAccess: eks.EndpointAccess.PRIVATE,
        defaultCapacity: 0,
        mastersRole: clusterAdmin,
        version: eks.KubernetesVersion.of(eksVersion.valueAsString),
        coreDnsComputeType: isFargetEnabled ? eks.CoreDnsComputeType.FARGATE : eks.CoreDnsComputeType.EC2,
      });
      this.setupClusterLogging(cluster);

      if (isFargetEnabled) {
        (cluster as eks.Cluster).addFargateProfile('FargetProfile', {
          selectors: [
            {
              namespace: 'kube-system',
              labels: {
                'k8s-app': 'kube-dns',
              },
            },
          ],
        });
      }

      const template = new ec2.LaunchTemplate(this, 'EKSManagedNodeTemplate', {
        blockDevices: [
          {
            deviceName: '/dev/xvda',
            volume: ec2.BlockDeviceVolume.ebs(30, {
              encrypted: true,
            }),
          },
        ],
        detailedMonitoring: true,
      });
      nodeGroup = (cluster as eks.Cluster).addNodegroupCapacity('nodegroup', {
        nodegroupName: 'nexus3',
        instanceTypes: [
          new ec2.InstanceType(this.node.tryGetContext('instanceType') ?? 'm5.large'),
        ],
        minSize: 1,
        maxSize: 3,
        launchTemplateSpec: {
          id: template.launchTemplateId!,
        },
        labels: {
          usage: 'nexus3',
        },
      });
      // Have to bind IAM role to node due to Nexus3 uses old AWS Java SDK not supporting IRSA
      // see https://github.com/sonatype/nexus-public/pull/69 for detail
      nodeGroup.role.attachInlinePolicy(new iam.Policy(this, 'NexusS3BlobStore', {
        statements: [s3BucketPolicy, s3ObjectPolicy],
      }));

      // install SSM agent as daemonset
      nodeGroup.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));

      (cluster.node.findChild('Resource').node.findChild('CreationRole').node.findChild('DefaultPolicy')
        .node.findChild('Resource') as cdk.CfnResource).addMetadata('cfn_nag', {
        rules_to_suppress: [
          {
            id: 'W12',
            reason: 'wildcard in policy is built by CDK',
          },
        ],
      });

      var ssmManifests = request('GET', 'https://raw.githubusercontent.com/aws-samples/ssm-agent-daemonset-installer/541da0a68a96d5b2ce184724f3d35d22d9ac7236/setup.yaml')
        .getBody('utf-8');

      if (targetRegion.startsWith('cn-')) {
        ssmManifests = ssmManifests.replace('https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm',
          'https://s3.cn-north-1.amazonaws.com.cn/amazon-ssm-cn-north-1/latest/linux_amd64/amazon-ssm-agent.rpm')
          .replace('jicowan/ssm-agent-installer:1.2', '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/dockerhub/jicowan/ssm-agent-installer:1.2')
          .replace('gcr.io/google-containers/pause:2.0', '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/gcr/google-containers/pause:2.0');
      }
      const ssmInstallerResources = yaml.safeLoadAll(ssmManifests);
      cluster.addManifest('ssm-agent-daemonset', ...ssmInstallerResources);
    }

    // install AWS load balancer via Helm charts
    const awsLoadBalancerControllerVersion = 'v2.4.1';
    const awsControllerBaseResourceBaseUrl = `https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${awsLoadBalancerControllerVersion}/docs`;
    const awsControllerPolicyUrl = `${awsControllerBaseResourceBaseUrl}/install/iam_policy${targetRegion.startsWith('cn-') ? '_cn' : ''}.json`;
    const albNamespace = 'kube-system';
    const albServiceAccount = cluster.addServiceAccount('aws-load-balancer-controller', {
      name: 'aws-load-balancer-controller',
      namespace: albNamespace,
    });
    const customResourceRole = cdk.Stack.of(this).node.tryFindChild('Custom::AWSCDKOpenIdConnectProviderCustomResourceProvider');
    if (customResourceRole) {
      (customResourceRole.node.findChild('Role') as cdk.CfnResource).addMetadata('cfn_nag', {
        rules_to_suppress: [
          {
            id: 'W11',
            reason: 'wildcard in policy built by CDK',
          },
        ],
      });
    }

    const policyJson = request('GET', awsControllerPolicyUrl).getBody();
    ((JSON.parse(policyJson)).Statement as []).forEach((statement, _idx, _array) => {
      albServiceAccount.addToPrincipalPolicy(iam.PolicyStatement.fromJson(statement));
    });
    const albSAPolicy = albServiceAccount.role.node.children.filter(c => c instanceof iam.Policy)[0].node.defaultChild as iam.CfnPolicy;
    albSAPolicy.addMetadata('cfn_nag', {
      rules_to_suppress: [
        {
          id: 'W76',
          reason: 'the policy statement is from official doc of AWS load balancer controller',
        },
        {
          id: 'W12',
          reason: 'the policy statement is from official doc of AWS load balancer controller',
        },
      ],
    });
    const awsLoadBalancerControllerChart = cluster.addHelmChart('AWSLoadBalancerController', {
      chart: 'aws-load-balancer-controller',
      repository: partitionMapping.findInMap(cdk.Aws.PARTITION, 'albHelmChartRepo'),
      namespace: albNamespace,
      release: 'aws-load-balancer-controller',
      version: '1.4.1', // mapping to v2.4.1
      wait: true,
      timeout: cdk.Duration.minutes(15),
      values: {
        clusterName: cluster.clusterName,
        image: {
          repository: this.getAwsLoadBalancerControllerRepo(),
        },
        serviceAccount: {
          create: false,
          name: albServiceAccount.serviceAccountName,
        },
        // must disable waf features for aws-cn partition
        enableShield: false,
        enableWaf: false,
        enableWafv2: false,
      },
    });

    if (cluster instanceof eks.Cluster) {
      awsLoadBalancerControllerChart.node.addDependency(nodeGroup!);
      awsLoadBalancerControllerChart.node.addDependency(cluster.awsAuth);
    }
    awsLoadBalancerControllerChart.node.addDependency(albServiceAccount);
    awsLoadBalancerControllerChart.node.addDependency(cluster.openIdConnectProvider);

    // deploy EFS, EFS CSI driver, PV
    const efsCSI = cluster.addHelmChart('EFSCSIDriver', {
      chart: 'aws-efs-csi-driver',
      repository: partitionMapping.findInMap(cdk.Aws.PARTITION, 'efsCSIHelmChartRepo'),
      release: 'aws-efs-csi-driver',
      version: '2.2.0', // mapping to v1.3.4
    });
    if (cluster instanceof eks.Cluster) {
      efsCSI.node.addDependency(nodeGroup!);
      efsCSI.node.addDependency(cluster.awsAuth);
    }
    efsCSI.node.addDependency(cluster.openIdConnectProvider);

    const fileSystem = new efs.FileSystem(this, 'Nexus3FileSystem', {
      vpc,
      encrypted: true,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
    });
    fileSystem.connections.allowDefaultPortFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock),
      'allow access efs from inside vpc');
    fileSystem.connections.securityGroups.forEach(sg =>
      (sg.node.defaultChild as ec2.CfnSecurityGroup).applyRemovalPolicy(cdk.RemovalPolicy.DESTROY));
    const efsClass = 'efs-sc';
    const efsStorageClass = cluster.addManifest('efs-storageclass',
      {
        kind: 'StorageClass',
        apiVersion: 'storage.k8s.io/v1',
        metadata: {
          name: efsClass,
        },
        provisioner: 'efs.csi.aws.com',
      });
    efsStorageClass.node.addDependency(efsCSI);
    const efsPVName = 'nexus3-oss-efs-pv';
    const efsPV = cluster.addManifest('efs-pv', {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name: efsPVName,
      },
      spec: {
        capacity: {
          storage: '1000Gi',
        },
        volumeMode: 'Filesystem',
        accessModes: [
          'ReadWriteMany',
        ],
        persistentVolumeReclaimPolicy: 'Retain',
        storageClassName: efsClass,
        csi: {
          driver: 'efs.csi.aws.com',
          volumeHandle: fileSystem.fileSystemId,
        },
      },
    });
    efsPV.node.addDependency(fileSystem);
    efsPV.node.addDependency(efsStorageClass);

    const nexus3Namespace = 'default';
    const nexus3ChartName = 'nexus3';
    const nexusServiceAccount = cluster.addServiceAccount('sonatype-nexus3', {
      name: 'sonatype-nexus3',
      namespace: nexus3Namespace,
    });

    nexusServiceAccount.addToPolicy(s3BucketPolicy);
    nexusServiceAccount.addToPolicy(s3ObjectPolicy);

    const albLogServiceAccountMapping = new cdk.CfnMapping(this, 'ALBServiceAccountMapping', {
      mapping: {
        'me-south-1': {
          account: '076674570225',
        },
        'eu-south-1': {
          account: '635631232127',
        },
        'ap-northeast-1': {
          account: '582318560864',
        },
        'ap-northeast-2': {
          account: '600734575887',
        },
        'ap-northeast-3': {
          account: '383597477331',
        },
        'ap-south-1': {
          account: '718504428378',
        },
        'ap-southeast-1': {
          account: '114774131450',
        },
        'ap-southeast-2': {
          account: '783225319266',
        },
        'ca-central-1': {
          account: '985666609251',
        },
        'eu-central-1': {
          account: '054676820928',
        },
        'eu-north-1': {
          account: '897822967062',
        },
        'eu-west-1': {
          account: '156460612806',
        },
        'eu-west-2': {
          account: '652711504416',
        },
        'eu-west-3': {
          account: '009996457667',
        },
        'sa-east-1': {
          account: '507241528517',
        },
        'us-east-1': {
          account: '127311923021',
        },
        'us-east-2': {
          account: '033677994240',
        },
        'us-west-1': {
          account: '027434742980',
        },
        'us-west-2': {
          account: '797873946194',
        },
        'ap-east-1': {
          account: '754344448648',
        },
        'af-south-1': {
          account: '098369216593',
        },
        'cn-north-1': {
          account: '638102146993',
        },
        'cn-northwest-1': {
          account: '037604701340',
        },
      },
    });
    const albLogPrefix = 'albAccessLog';
    logBucket.grantPut(new iam.AccountPrincipal(albLogServiceAccountMapping.findInMap(cdk.Aws.REGION, 'account')),
      `${albLogPrefix}/AWSLogs/${cdk.Aws.ACCOUNT_ID}/*`);

    const nexusPort = 8081;
    const healthcheckPath = '/';
    var albOptions = {
      'alb.ingress.kubernetes.io/backend-protocol': 'HTTP',
      'alb.ingress.kubernetes.io/healthcheck-path': healthcheckPath,
      'alb.ingress.kubernetes.io/healthcheck-port': nexusPort,
      'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}]',
      'alb.ingress.kubernetes.io/scheme': internalALB ? 'internal' : 'internet-facing',
      'alb.ingress.kubernetes.io/inbound-cidrs': internalALB ? vpc.vpcCidrBlock : '0.0.0.0/0',
      'alb.ingress.kubernetes.io/auth-type': 'none',
      'alb.ingress.kubernetes.io/target-type': 'ip',
      'kubernetes.io/ingress.class': 'alb',
      'alb.ingress.kubernetes.io/tags': 'app=nexus3',
      'alb.ingress.kubernetes.io/subnets': vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
      'alb.ingress.kubernetes.io/load-balancer-attributes': `access_logs.s3.enabled=true,access_logs.s3.bucket=${logBucket.bucketName},access_logs.s3.prefix=${albLogPrefix}`,
    };
    const ingressRules : Array<any> = [
      {
        http: {
          paths: [
            {
              path: '/',
	      pathType: 'Prefix',
              backend: {
                service: {
                  name: `${nexus3ChartName}-sonatype-nexus`,
		  port: {
		    number: nexusPort,
		},
               },
              },
            },
          ],
        },
      },
    ];
    var externalDNSResource: cdk.Construct;
    if (certificate) {
      Object.assign(albOptions, {
        'alb.ingress.kubernetes.io/certificate-arn': certificate.certificateArn,
        'alb.ingress.kubernetes.io/ssl-policy': 'ELBSecurityPolicy-TLS-1-2-Ext-2018-06',
        'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}, {"HTTPS": 443}]',
        'alb.ingress.kubernetes.io/actions.ssl-redirect': '{"Type": "redirect", "RedirectConfig": { "Protocol": "HTTPS", "Port": "443", "StatusCode": "HTTP_301"}}',
      });

      ingressRules.splice(0, 0, {
        host: domainName,
        http: {
          paths: [
            {
              path: '/',
	      pathType: 'Prefix',
              backend: {
                service: {
                  name: 'ssl-redirect',
                  port: {
		    number:  'use-annotation',
                },
              },
            },
	   },
            {
              path: '/',
	      pathType: 'Prefix',
              backend: {
                service :{
                  name: `${nexus3ChartName}-sonatype-nexus`,
                  port: {
		    number:  nexusPort,
           	 },
	       },
              },
            },
          ],
        },
      });

      // install external dns
      const externalDNSNamespace = 'default';
      const externalDNSServiceAccount = cluster.addServiceAccount('external-dns', {
        name: 'external-dns',
        namespace: externalDNSNamespace,
      });

      const r53ListPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'route53:ListHostedZones',
          'route53:ListResourceRecordSets',
        ],
        resources: ['*'],
      });
      const r53UpdateRecordPolicy = new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'route53:ChangeResourceRecordSets',
        ],

        resources: [hostedZone!.hostedZoneArn!],
      });
      externalDNSServiceAccount.addToPolicy(r53ListPolicy);
      externalDNSServiceAccount.addToPolicy(r53UpdateRecordPolicy!);

      const externalDNSResources = yaml.safeLoadAll(
        request('GET', `${awsControllerBaseResourceBaseUrl}/examples/external-dns.yaml`)
          .getBody('utf-8').replace('external-dns-test.my-org.com', r53Domain ?? '')
          .replace('my-identifier', 'nexus3'))
        .filter((res: any) => { return res.kind != 'ServiceAccount'; })
        .map((res: any) => {
          if (res.kind === 'Deployment') {
            res.spec.template.spec.containers[0].env = [
              {
                name: 'AWS_REGION',
                value: cdk.Aws.REGION,
              },
            ];
          }
          return res;
        });

      const externalDNS = cluster.addManifest('external-dns', ...externalDNSResources);
      externalDNS.node.addDependency(externalDNSServiceAccount);
      externalDNSResource = externalDNS;
    }

    const enableAutoConfigured: boolean = this.node.tryGetContext('enableAutoConfigured') || false;
    const nexus3ChartVersion = '5.4.0';

    const nexus3PurgeFunc = new lambda_python.PythonFunction(this, 'Nexus3Purge', {
      description: 'Func purges the resources(such as pvc) left after deleting Nexus3 helm chart',
      entry: path.join(__dirname, '../lambda.d/nexus3-purge'),
      index: 'index.py',
      handler: 'handler',
      runtime: lambda.Runtime.PYTHON_3_7,
      environment: cluster.kubectlEnvironment,
      logRetention: logs.RetentionDays.ONE_MONTH,
      timeout: cdk.Duration.minutes(15),
      layers: [
        new AwsCliLayer(this, 'AwsCliLayer'),
        new KubectlLayer(this, 'KubectlLayer'),
      ],
      vpc: vpc,
      securityGroups: cluster.kubectlSecurityGroup ? [cluster.kubectlSecurityGroup] : undefined,
      vpcSubnets: cluster.kubectlPrivateSubnets ? { subnets: cluster.kubectlPrivateSubnets } : undefined,
    });
    nexus3PurgeFunc.role!.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['eks:DescribeCluster'],
      resources: [cluster.clusterArn],
    }));
    // allow this handler to assume the kubectl role
    cluster.kubectlRole!.grant(nexus3PurgeFunc.role!, 'sts:AssumeRole');

    const nexus3PurgeCR = new cdk.CustomResource(this, 'Nexus3PurgeCR', {
      serviceToken: nexus3PurgeFunc.functionArn,
      resourceType: 'Custom::Nexus3-Purge',
      properties: {
        ClusterName: cluster.clusterName,
        RoleArn: cluster.kubectlRole!.roleArn,
        ObjectType: 'ingress',
        ObjectName: `${nexus3ChartName}-sonatype-nexus`,
        ObjectNamespace: nexus3Namespace,
        JsonPath: '.status.loadBalancer.ingress[0].hostname',
        TimeoutSeconds: cdk.Duration.minutes(6).toSeconds(),
        Release: nexus3ChartName,
      },
    });
    nexus3PurgeCR.node.addDependency(efsPV);
    nexus3PurgeCR.node.addDependency(awsLoadBalancerControllerChart);

    let nexus3ChartProperties: { [key: string]: any } = {
      statefulset: {
        enabled: true,
      },
      initAdminPassword: {
        enabled: true,
        password: adminInitPassword.valueAsString,
      },
      nexus: {
        imageName: partitionMapping.findInMap(cdk.Aws.PARTITION, 'nexus'),
        resources: {
          requests: {
            memory: '4800Mi',
          },
        },
        livenessProbe: {
          path: healthcheckPath,
        },
      },
      nexusProxy: {
        enabled: false,
      },
      persistence: {
        enabled: true,
        storageClass: efsClass,
        accessMode: 'ReadWriteMany',
      },
      nexusBackup: {
        enabled: false,
        persistence: {
          enabled: false,
        },
      },
      nexusCloudiam: {
        enabled: false,
        persistence: {
          enabled: false,
        },
      },
      ingress: {
        enabled: true,
        path: '/*',
        annotations: albOptions,
        tls: {
          enabled: false,
        },
        rules: ingressRules,
      },
      serviceAccount: {
        create: false,
        // uncomment below line when using IRSA for nexus
        // name: nexusServiceAccount.serviceAccountName,
      },
    };
    if (enableAutoConfigured) {
      // enalbe script feature of nexus3
      nexus3ChartProperties = {
        ...nexus3ChartProperties,
        config: {
          enabled: true,
          data: {
            'nexus.properties': 'nexus.scripts.allowCreation=true',
          },
        },
        deployment: {
          additionalVolumeMounts: [
            {
              mountPath: '/nexus-data/etc/nexus.properties',
              subPath: 'nexus.properties',
              name: 'sonatype-nexus-conf',
            },
          ],
        },
      };
    }
    const nexus3Chart = cluster.addHelmChart('Nexus3', {
      chart: 'sonatype-nexus',
      repository: partitionMapping.findInMap(cdk.Aws.PARTITION, 'nexusHelmChartRepo'),
      namespace: nexus3Namespace,
      release: nexus3ChartName,
      version: nexus3ChartVersion,
      wait: true,
      timeout: cdk.Duration.minutes(15),
      values: nexus3ChartProperties,
    });
    nexus3Chart.node.addDependency(nexusServiceAccount);
    nexus3Chart.node.addDependency(nexus3PurgeCR);
    if (certificate) {
      nexus3PurgeCR.node.addDependency(certificate);
      nexus3Chart.node.addDependency(certificate);
      nexus3Chart.node.addDependency(externalDNSResource!);
    }
    const albAddress = new eks.KubernetesObjectValue(this, 'Nexus3ALBAddress', {
      cluster,
      objectType: 'ingress',
      objectNamespace: nexus3Namespace,
      objectName: `${nexus3ChartName}-sonatype-nexus`,
      jsonPath: '.status.loadBalancer.ingress[0].hostname',
    });
    albAddress.node.addDependency(nexus3Chart);

    if (enableAutoConfigured) {
      const nexusEndpointHostname = `http://${albAddress.value}`;
      if (nexusEndpointHostname) {
        const autoConfigureFunc = new lambda_python.PythonFunction(this, 'Neuxs3AutoCofingure', {
          entry: path.join(__dirname, '../lambda.d/nexuspreconfigure'),
          index: 'index.py',
          handler: 'handler',
          runtime: lambda.Runtime.PYTHON_3_8,
          logRetention: logs.RetentionDays.ONE_MONTH,
          timeout: cdk.Duration.minutes(5),
          vpc: vpc,
        });

        const nexus3AutoConfigureCR = new cdk.CustomResource(this, 'Neuxs3AutoCofingureCustomResource', {
          serviceToken: autoConfigureFunc.functionArn,
          resourceType: 'Custom::Nexus3-AutoConfigure',
          properties: {
            Username: 'admin',
            Password: adminInitPassword.valueAsString,
            Endpoint: nexusEndpointHostname,
            S3BucketName: nexusBlobBucket.bucketName,
          },
        });
        nexus3AutoConfigureCR.node.addDependency(nexus3Chart);

        const addCondition = (): void => {
          if (eksVersion) {
            const eksV119 = new cdk.CfnCondition(this, 'EKSV1.19', {
              expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals('1.19', eksVersion.valueAsString)),
            });
            autoConfigureFunc.node.children.forEach(r => {
              if (r instanceof cdk.CfnResource) {
                (r as cdk.CfnResource).cfnOptions.condition = eksV119;
              } else {
                r.node.children.forEach(r1 => {
                  if (r1 instanceof cdk.CfnResource) {
                    (r1 as cdk.CfnResource).cfnOptions.condition = eksV119;
                  }
                });
              }

            });
            nexus3AutoConfigureCR.node.children.forEach(r => { (r as cdk.CfnResource).cfnOptions.condition = eksV119; });
          }
        };
        addCondition();
      }
    }

    cdk.Aspects.of(cdk.Stack.of(cluster)).add({
      visit: (node: cdk.IConstruct) => {
        if (node instanceof lambda.CfnFunction) {
          node.addPropertyOverride('Environment.Variables.AWS_STS_REGIONAL_ENDPOINTS', 'regional');
        }
      },
    });

    // the hardcode id is copied from https://github.com/aws/aws-cdk/blob/099b5840cc5b45bad987b7e797e6009d6383a3a7/packages/%40aws-cdk/aws-logs/lib/log-retention.ts#L119
    (cdk.Stack.of(this).node.findChild('LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a')
      .node.findChild('ServiceRole').node.findChild('DefaultPolicy').node
      .findChild('Resource') as cdk.CfnResource).addMetadata('cfn_nag', {
      rules_to_suppress: [
        {
          id: 'W12',
          reason: 'wildcard in policy is built by CDK',
        },
      ],
    });

    new cdk.CfnOutput(this, 'nexus-oss-s3-bucket-blobstore', {
      value: `${nexusBlobBucket.bucketName}`,
      description: 'S3 Bucket created for Nexus OSS Blobstore',
    });
    new cdk.CfnOutput(this, 'nexus-oss-alb-domain', {
      value: `${albAddress.value}`,
      description: 'load balancer domain of Nexus OSS',
    });

    this.templateOptions.description = `(SO8020) - Sonatype Nexus Repository OSS on AWS. Template version ${pjson.version}`;
  }

  /**
   * The info is retrieved from https://github.com/kubernetes-sigs/aws-load-balancer-controller/releases
   */
  getAwsLoadBalancerControllerRepo() {
    const albImageMapping = new cdk.CfnMapping(this, 'ALBImageMapping', {
      mapping: {
        'me-south-1': {
          2: '558608220178',
        },
        'eu-south-1': {
          2: '590381155156',
        },
        'ap-northeast-1': {
          2: '602401143452',
        },
        'ap-northeast-2': {
          2: '602401143452',
        },
        'ap-south-1': {
          2: '602401143452',
        },
        'ap-southeast-1': {
          2: '602401143452',
        },
        'ap-southeast-2': {
          2: '602401143452',
        },
        'ca-central-1': {
          2: '602401143452',
        },
        'eu-central-1': {
          2: '602401143452',
        },
        'eu-north-1': {
          2: '602401143452',
        },
        'eu-west-1': {
          2: '602401143452',
        },
        'eu-west-2': {
          2: '602401143452',
        },
        'eu-west-3': {
          2: '602401143452',
        },
        'sa-east-1': {
          2: '602401143452',
        },
        'us-east-1': {
          2: '602401143452',
        },
        'us-east-2': {
          2: '602401143452',
        },
        'us-west-1': {
          2: '602401143452',
        },
        'us-west-2': {
          2: '602401143452',
        },
        'ap-east-1': {
          2: '800184023465',
        },
        'af-south-1': {
          2: '877085696533',
        },
        'cn-north-1': {
          2: '918309763551',
        },
        'cn-northwest-1': {
          2: '961992271922',
        },
      },
    });
    return `${albImageMapping.findInMap(cdk.Aws.REGION, '2')}.dkr.ecr.${cdk.Aws.REGION}.${cdk.Aws.URL_SUFFIX}/amazon/aws-load-balancer-controller`;
  }

  private azOfSubnets(subnets: ec2.ISubnet[]): number {
    return new Set(subnets.map(subnet => subnet.availabilityZone)).size;
  }

  setupClusterLogging(cluster: eks.ICluster): void {
    new AwsCustomResource(this, 'ClusterLogsEnabler', {
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [`${cluster.clusterArn}/update-config`],
      }),
      onCreate: {
        physicalResourceId: { id: `${cluster.clusterArn}/LogsEnabler` },
        service: 'EKS',
        action: 'updateClusterConfig',
        region: this.region,
        parameters: {
          name: cluster.clusterName,
          logging: {
            clusterLogging: [
              {
                enabled: true,
                types: [
                  'api',
                  'audit',
                  'authenticator',
                  'controllerManager',
                  'scheduler',
                ],
              },
            ],
          },
        },
      },
      onDelete: {
        physicalResourceId: { id: `${cluster.clusterArn}/LogsEnabler` },
        service: 'EKS',
        action: 'updateClusterConfig',
        region: this.region,
        parameters: {
          name: cluster.clusterName,
          logging: {
            clusterLogging: [
              {
                enabled: false,
                types: [
                  'api',
                  'audit',
                  'authenticator',
                  'controllerManager',
                  'scheduler',
                ],
              },
            ],
          },
        },
      },
    });
  }
}
