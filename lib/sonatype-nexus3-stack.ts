import * as cdk from '@aws-cdk/core';
const assert = require('assert').strict;
import * as certmgr from "@aws-cdk/aws-certificatemanager";
import * as eks from '@aws-cdk/aws-eks';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as efs from '@aws-cdk/aws-efs';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambda_python from '@aws-cdk/aws-lambda-python';
import * as logs from '@aws-cdk/aws-logs';
import * as path from 'path';
import * as s3 from '@aws-cdk/aws-s3';
import * as route53 from '@aws-cdk/aws-route53';

export class SonatypeNexus3Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const partitionMapping = new cdk.CfnMapping(this, 'PartitionMapping', {
      mapping: {
        aws: {
          nexus: 'quay.io/travelaudience/docker-nexus',
          nexusProxy: 'quay.io/travelaudience/docker-nexus-proxy',
          // see https://github.com/aws/aws-cdk/blob/60c782fe173449ebf912f509de7db6df89985915/packages/%40aws-cdk/aws-eks/lib/kubectl-layer.ts
          kubectlLayerAppid: 'arn:aws:serverlessrepo:us-east-1:903779448426:applications/lambda-layer-kubectl',
        },
        'aws-cn': {
          nexus: '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/quay/travelaudience/docker-nexus',
          nexusProxy: '048912060910.dkr.ecr.cn-northwest-1.amazonaws.com.cn/quay/travelaudience/docker-nexus-proxy',
          kubectlLayerAppid: 'arn:aws-cn:serverlessrepo:cn-north-1:487369736442:applications/lambda-layer-kubectl',
        },
      }
    });

    const domainNameParameter = new cdk.CfnParameter(this, 'domainName', {
      type: 'String',
      allowedPattern: '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]',
      description: 'The domain name of Nexus OSS deployment.'
    });
    const domainName = domainNameParameter.valueAsString;
    if (!domainName)
      throw new Error('Must specify the custom domain name.');

    var hostedZone = null;
    var certificate: certmgr.Certificate | undefined;
    const r53Domain = this.node.tryGetContext('r53Domain');
    if (r53Domain) {
      hostedZone = route53.HostedZone.fromLookup(this, 'R53HostedZone', {
        domainName: r53Domain,
        privateZone: false,
      });
      assert.ok(hostedZone != null, 'Can not find your hosted zone.');
      certificate = new certmgr.Certificate(this, `SSLCertificate`, {
        domainName: domainName,
        validation: certmgr.CertificateValidation.fromDns(hostedZone),
      });
    } else if ((/true/i).test(this.node.tryGetContext('enableR53HostedZone'))) {
      const r53HostedZoneIdParameter = new cdk.CfnParameter(this, 'r53HostedZoneId', {
        type: 'String',
        default: '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]',
        description: 'The hosted zone ID of given domain name.'
      });
      hostedZone = route53.HostedZone.fromHostedZoneId(this, 'ImportedHostedZone', r53HostedZoneIdParameter.valueAsString);
      certificate = new certmgr.Certificate(this, `SSLCertificate`, {
        domainName: domainName,
        validation: certmgr.CertificateValidation.fromDns(hostedZone),
      });
    }
    let vpc!: ec2.IVpc;
    let createNewVpc: boolean = this.node.tryGetContext('createNewVpc') ?? false
    if (createNewVpc) {
      vpc = new ec2.Vpc(this, 'NexusVpc', {
        maxAzs: 2,
        natGateways: 1,
      })
    }
    else {
      vpc = ec2.Vpc.fromLookup(this, 'vpc', {
        isDefault: true
      });
      if (this.azOfSubnets(vpc.publicSubnets) <= 1 ||
        this.azOfSubnets(vpc.privateSubnets) <= 1) {
        throw new Error(`VPC '${vpc.vpcId}' must have both public and private subnets cross two AZs at least.`);
      }
    }

    const clusterAdmin = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const kubectlLayer = new eks.KubectlLayer(this, 'KubeLayer', {
      applicationId: partitionMapping.findInMap(cdk.Aws.PARTITION, 'kubectlLayerAppid'),
    });
    const isFargetEnabled = (this.node.tryGetContext('enableFarget') || 'false').toLowerCase() === 'true';
    const cluster = new eks.Cluster(this, 'MyK8SCluster', {
      vpc,
      defaultCapacity: 0,
      kubectlEnabled: true,
      mastersRole: clusterAdmin,
      version: eks.KubernetesVersion.V1_16,
      coreDnsComputeType: isFargetEnabled ? eks.CoreDnsComputeType.FARGATE : eks.CoreDnsComputeType.EC2,
      kubectlLayer,
    });

    const nexusBlobBucket = new s3.Bucket(this, `nexus3-blobstore`, {
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const s3BucketPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:ListBucket',
      ],
      resources: ['*'],
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
        nexusBlobBucket.arnForObjects('*')
      ],
    });

    const nodeRole = new iam.Role(this, 'NodeRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('ec2.amazonaws.com')),
      inlinePolicies: {
        s3: new iam.PolicyDocument({
          statements: [s3BucketPolicy, s3ObjectPolicy]
        }),
      },
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEC2ContainerRegistryReadOnly'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
      ]
    });

    if (isFargetEnabled) {
      cluster.addFargateProfile('FargetProfile', {
        selectors: [
          {
            namespace: 'kube-system',
            labels: {
              'k8s-app': 'kube-dns',
            }
          }
        ]
      });
    }

    cluster.addNodegroupCapacity('nodegroup', {
      nodegroupName: 'nexus3',
      instanceType: new ec2.InstanceType(this.node.tryGetContext('instanceType') ?? 'm5.large'),
      minSize: 1,
      maxSize: 3,
      // Have to bind IAM role to node due to Nexus3 uses old AWS Java SDK not supporting IRSA
      // see https://github.com/sonatype/nexus-public/pull/69 for detail
      nodeRole,
      labels: {
        usage: 'nexus3'
      },
    });

    // install AWS load balancer via Helm charts
    const awsLoadBalancerControllerVersion = 'v2.0.1';
    const awsControllerBaseResourceBaseUrl = `https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/${awsLoadBalancerControllerVersion}/docs`;
    const targetRegion = this.node.tryGetContext('region') ?? 'us-east-1';
    const awsControllerPolicyUrl = `${awsControllerBaseResourceBaseUrl}/install/iam_policy${targetRegion.startsWith('cn-') ? '_cn' : ''}.json`;
    const albNamespace = 'kube-system';
    const albServiceAccount = cluster.addServiceAccount('aws-load-balancer-controller', {
      name: 'aws-load-balancer-controller',
      namespace: albNamespace,
    });

    const request = require('sync-request');
    const yaml = require('js-yaml');

    const policyJson = request('GET', awsControllerPolicyUrl).getBody();
    ((JSON.parse(policyJson))['Statement'] as []).forEach((statement, idx, array) => {
      albServiceAccount.addToPolicy(iam.PolicyStatement.fromJson(statement));
    });
    const awsLoadBalancerControllerChart = cluster.addHelmChart('AWSLoadBalancerController', {
      chart: 'aws-load-balancer-controller',
      repository: 'https://aws.github.io/eks-charts',
      namespace: albNamespace,
      release: 'aws-load-balancer-controller',
      version: '1.0.8', // mapping to v2.0.1
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

    // deploy EFS, EFS CSI driver, PV
    const efsCSI = cluster.addHelmChart('EFSCSIDriver', {
      chart: 'https://github.com/kubernetes-sigs/aws-efs-csi-driver/releases/download/v0.3.0/helm-chart.tgz',
    });

    const fileSystem = new efs.FileSystem(this, 'Nexus3FileSystem', {
      vpc,
      encrypted: false,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_14_DAYS,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING
    });
    fileSystem.connections.allowDefaultPortFrom(ec2.Peer.ipv4(vpc.vpcCidrBlock),
      'allow access efs from inside vpc');
    const efsClass = 'efs-sc';
    cluster.addManifest('efs-storageclass',
      {
        kind: 'StorageClass',
        apiVersion: 'storage.k8s.io/v1',
        metadata: {
          name: efsClass,
        },
        provisioner: 'efs.csi.aws.com'
      });
    const efsPV = cluster.addManifest('efs-pv', {
      apiVersion: 'v1',
      kind: 'PersistentVolume',
      metadata: {
        name: 'efs-pv'
      },
      spec: {
        capacity: {
          storage: '1000Gi'
        },
        volumeMode: 'Filesystem',
        accessModes: [
          'ReadWriteMany'
        ],
        persistentVolumeReclaimPolicy: 'Retain',
        storageClassName: efsClass,
        csi: {
          driver: 'efs.csi.aws.com',
          volumeHandle: fileSystem.fileSystemId,
        }
      }
    });
    efsPV.node.addDependency(fileSystem);
    efsPV.node.addDependency(efsCSI);

    const nexus3Namespace = 'default';
    const nexusServiceAccount = cluster.addServiceAccount('sonatype-nexus3', {
      name: 'sonatype-nexus3',
      namespace: nexus3Namespace,
    });

    nexusServiceAccount.addToPolicy(s3BucketPolicy);
    nexusServiceAccount.addToPolicy(s3ObjectPolicy);
    const nexusPort = 8081;
    const healthcheckPath = '/';
    var albOptions = {
      'alb.ingress.kubernetes.io/backend-protocol': 'HTTP',
      'alb.ingress.kubernetes.io/healthcheck-path': healthcheckPath,
      'alb.ingress.kubernetes.io/healthcheck-port': nexusPort,
      'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}]',
      'alb.ingress.kubernetes.io/scheme': 'internet-facing',
      'alb.ingress.kubernetes.io/inbound-cidrs': '0.0.0.0/0',
      'alb.ingress.kubernetes.io/auth-type': 'none',
      'alb.ingress.kubernetes.io/target-type': 'ip',
      'kubernetes.io/ingress.class': 'alb',
      'alb.ingress.kubernetes.io/tags': 'app=nexus3',
      'alb.ingress.kubernetes.io/subnets': vpc.publicSubnets.map(subnet => subnet.subnetId).join(','),
    };
    var externalDNSResource: cdk.Construct;
    if (certificate) {
      Object.assign(albOptions, {
        'alb.ingress.kubernetes.io/certificate-arn': certificate.certificateArn,
        'alb.ingress.kubernetes.io/ssl-policy': 'ELBSecurityPolicy-TLS-1-2-Ext-2018-06',
        'alb.ingress.kubernetes.io/listen-ports': '[{"HTTP": 80}, {"HTTPS": 443}]',
        'alb.ingress.kubernetes.io/actions.ssl-redirect': '{"Type": "redirect", "RedirectConfig": { "Protocol": "HTTPS", "Port": "443", "StatusCode": "HTTP_301"}}',
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
          .replace('0.7.1', '0.7.4') // pick external-dns 0.7.2+ with Route53 fix in AWS China
          .replace('my-identifier', 'nexus3'))
        .filter((res: any) => { return res['kind'] != 'ServiceAccount' })
        .map((res: any) => {
          if (res['kind'] === 'ClusterRole') {
            res['rules'].push({
              apiGroups: [''],
              resources: ['endpoints'],
              verbs: ["get", "watch", "list"]
            });
          } else if (res['kind'] === 'Deployment') {
            res['spec']['template']['spec']['containers'][0]['env'] = [
              {
                name: 'AWS_REGION',
                value: cdk.Aws.REGION,
              }
            ];
            res['spec']['template']['spec']['securityContext'] = {
              fsGroup: 65534,
            };
          }
          return res;
        });

      const externalDNS = cluster.addManifest('external-dns', ...externalDNSResources);
      externalDNS.node.addDependency(externalDNSServiceAccount);
      externalDNSResource = externalDNS;
    }

    const enableAutoConfigured: boolean = this.node.tryGetContext('enableAutoConfigured') || false;
    const nexus3ChartName = 'nexus3';
    const nexus3ChartVersion = '2.1.0';
    let nexus3ChartProperties: { [key: string]: any } = {
      statefulset: {
        enabled: true,
      },
      nexus: {
        imageTag: '3.23.0',
        imageName: partitionMapping.findInMap(cdk.Aws.PARTITION, 'nexus'),
        resources: {
          requests: {
            cpu: '256m',
            memory: '4800Mi',
          }
        },
        livenessProbe: {
          path: healthcheckPath,
        },
        nodeSelector: {
          usage: 'nexus3',
        },
      },
      nexusProxy: {
        enabled: true,
        imageName: partitionMapping.findInMap(cdk.Aws.PARTITION, 'nexusProxy'),
        port: nexusPort,
        env: {
          nexusHttpHost: domainName
        }
      },
      persistence: {
        enabled: true,
        storageClass: efsClass,
        accessMode: 'ReadWriteMany'
      },
      nexusBackup: {
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
      },
      serviceAccount: {
        create: false,
      },
    };
    if (enableAutoConfigured) {
      // enalbe script feature of nexus3
      nexus3ChartProperties = {
        ...nexus3ChartProperties,
        config: {
          enabled: true,
          data: {
            'nexus.properties': 'nexus.scripts.allowCreation=true'
          }
        },
        deployment: {
          additionalVolumeMounts: [
            {
              mountPath: '/nexus-data/etc/nexus.properties',
              subPath: 'nexus.properties',
              name: 'sonatype-nexus-conf'
            }
          ]
        },
      };
    }
    const nexus3Chart = cluster.addHelmChart('Nexus3', {
      chart: 'sonatype-nexus',
      repository: 'https://oteemo.github.io/charts/',
      namespace: nexus3Namespace,
      release: nexus3ChartName,
      version: nexus3ChartVersion,
      wait: true,
      timeout: cdk.Duration.minutes(15),
      values: nexus3ChartProperties,
    });
    nexus3Chart.node.addDependency(nexusServiceAccount);
    nexus3Chart.node.addDependency(awsLoadBalancerControllerChart);
    if (certificate) {
      nexus3Chart.node.addDependency(certificate);
      nexus3Chart.node.addDependency(externalDNSResource!);

      // workaround patch to force redirecting http to https
      const nexus3IngressPatch = new eks.KubernetesPatch(this, `nexus3-ingress-patch-${nexus3ChartVersion}`, {
        cluster,
        resourceName: `ingress/${nexus3ChartName}-sonatype-nexus`,
        resourceNamespace: nexus3Namespace,
        applyPatch: {
          spec: {
            rules: [
              {
                host: domainName,
                http: {
                  paths: [
                    {
                      path: '/*',
                      backend: {
                        serviceName: 'ssl-redirect',
                        servicePort: 'use-annotation',
                      }
                    },
                    {
                      path: '/*',
                      backend: {
                        serviceName: `${nexus3ChartName}-sonatype-nexus`,
                        servicePort: nexusPort,
                      }
                    }
                  ]
                }
              }
            ]
          }
        },
        restorePatch: {
          spec: {
            rules: [
              {
                host: domainName,
                http: {
                  paths: [
                    {
                      path: '/*',
                      backend: {
                        serviceName: `${nexus3ChartName}-sonatype-nexus`,
                        servicePort: nexusPort,
                      }
                    }
                  ]
                }
              }
            ]
          }
        },
      });
      nexus3IngressPatch.node.addDependency(nexus3Chart);
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
      let nexusEndpointHostname: string | undefined;
      if (domainName)
        nexusEndpointHostname = `https://${domainName}`;
      else
        nexusEndpointHostname = `http://${albAddress.value}`;
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

        const nexus3AutoConfigureCR = new cdk.CustomResource(this, 'CustomResource', {
          serviceToken: autoConfigureFunc.functionArn,
          resourceType: 'Custom::Nexus3-AutoConfigure',
          properties: {
            Username: 'admin',
            Password: 'admin123',
            Endpoint: nexusEndpointHostname,
            S3BucketName: nexusBlobBucket.bucketName,
          },
        });
        nexus3AutoConfigureCR.node.addDependency(nexus3Chart);
      }
    }

    new cdk.CfnOutput(this, 'nexus3-s3-bucket-blobstore', {
      value: `${nexusBlobBucket.bucketName}`,
      description: 'S3 Bucket created for Nexus3 S3 Blobstore'
    });
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
      }
    }); 
    return `${albImageMapping.findInMap(cdk.Aws.REGION, '2')}.dkr.ecr.${cdk.Aws.REGION}.${cdk.Aws.URL_SUFFIX}/amazon/aws-load-balancer-controller`;
  }

  private azOfSubnets(subnets: ec2.ISubnet[]): number {
    return new Set(subnets.map(subnet => subnet.availabilityZone)).size;
  }
}
