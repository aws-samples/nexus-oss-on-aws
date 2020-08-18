import * as cdk from '@aws-cdk/core';
const assert = require('assert').strict;
import certmgr = require("@aws-cdk/aws-certificatemanager");
import eks = require('@aws-cdk/aws-eks');
import ec2 = require('@aws-cdk/aws-ec2');
import * as efs from '@aws-cdk/aws-efs';
import iam = require('@aws-cdk/aws-iam');
import s3 = require('@aws-cdk/aws-s3');
import route53 = require('@aws-cdk/aws-route53');

export class SonatypeNexus3Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // deploy sonatype-nexus3 chart
    const domainName = this.node.tryGetContext('domainName');
    if (!domainName)
      throw new Error('Must specify the custom domain name.');

    const stack = cdk.Stack.of(this);

    var hostedZone = null;
    var certificate: certmgr.Certificate | undefined;
    const r53Domain = this.node.tryGetContext('r53Domain');
    if (r53Domain) {
      hostedZone = route53.HostedZone.fromLookup(this, 'R53HostedZone', {
        domainName: r53Domain,
        privateZone: false,
      });
      assert.ok(hostedZone != null, 'Can not find your hosted zone.');
      certificate = new certmgr.Certificate(this, `Certificate-${domainName}`, {
        domainName: domainName,
        validation: certmgr.CertificateValidation.fromDns(hostedZone),
      });
    }

    const vpc = ec2.Vpc.fromLookup(this, 'vpc', {
      isDefault: true
    });
    if (this.azOfSubnets(vpc.publicSubnets) <= 1 || 
      this.azOfSubnets(vpc.privateSubnets) <= 1) {
        throw new Error(`VPC '${vpc.vpcId}' must have both public and private subnets cross two AZs at least.`);
    }

    const clusterAdmin = new iam.Role(this, 'AdminRole', {
      assumedBy: new iam.AccountRootPrincipal()
    });

    const isFargetEnabled = (this.node.tryGetContext('enableFarget') || 'false').toLowerCase() === 'true';
    const cluster = new eks.Cluster(this, 'MyK8SCluster', {
      vpc,
      defaultCapacity: 0,
      kubectlEnabled: true,
      mastersRole: clusterAdmin,
      version: eks.KubernetesVersion.V1_17,
      coreDnsComputeType: isFargetEnabled ? eks.CoreDnsComputeType.FARGATE : eks.CoreDnsComputeType.EC2,
    });

    const nexusBlobBucket = new s3.Bucket(this, `nexus3-blobstore`, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
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
    
    cluster.addNodegroup('nodegroup', {
      nodegroupName: 'nexus3',
      instanceType: new ec2.InstanceType('m5.large'),
      minSize: 1,
      maxSize: 3,
      // Have to bind IAM role to node due to Nexus3 uses old AWS Java SDK not supporting IRSA
      // see https://github.com/sonatype/nexus-public/pull/69 for detail
      nodeRole,
      labels: {
        usage: 'nexus3'
      },
    });

    const albIngressControllerVersion = 'v1.1.8';
    const albBaseResourceBaseUrl = `https://raw.githubusercontent.com/kubernetes-sigs/aws-alb-ingress-controller/${albIngressControllerVersion}/docs/examples/`;
    const albIngressControllerPolicyUrl = `${albBaseResourceBaseUrl}iam-policy.json`;
    const albNamespace = 'kube-system';
    const albServiceAccount = cluster.addServiceAccount('alb-ingress-controller', {
      name: 'alb-ingress-controller',
      namespace: albNamespace,
    });

    const request = require('sync-request');
    const policyJson = request('GET', albIngressControllerPolicyUrl).getBody();
    ((JSON.parse(policyJson))['Statement'] as []).forEach((statement, idx, array) => {
      albServiceAccount.addToPolicy(iam.PolicyStatement.fromJson(statement));
    });

    const yaml = require('js-yaml');
    const rbacRoles = yaml.safeLoadAll(request('GET', `${albBaseResourceBaseUrl}rbac-role.yaml`).getBody())
      .filter((rbac: any) => { return rbac['kind'] != 'ServiceAccount' });
    const albDeployment = yaml.safeLoad(request('GET', `${albBaseResourceBaseUrl}alb-ingress-controller.yaml`).getBody());

    const albResources = cluster.addResource('aws-alb-ingress-controller', ...rbacRoles, albDeployment);
    const albResourcePatch = new eks.KubernetesPatch(this, `alb-ingress-controller-patch-${albIngressControllerVersion}`, {
      cluster,
      resourceName: "deployment/alb-ingress-controller",
      resourceNamespace: albNamespace,
      applyPatch: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: 'alb-ingress-controller',
                  args: [
                    '--ingress-class=alb',
                    '--feature-gates=wafv2=false',
                    `--cluster-name=${cluster.clusterName}`,
                    `--aws-vpc-id=${vpc.vpcId}`,
                    `--aws-region=${stack.region}`,
                  ]
                }
              ]
            }
          }
        }
      },
      restorePatch: {
        spec: {
          template: {
            spec: {
              containers: [
                {
                  name: 'alb-ingress-controller',
                  args: [
                    '--ingress-class=alb',
                    '--feature-gates=wafv2=false',
                    `--cluster-name=${cluster.clusterName}`,
                  ]
                }
              ]
            }
          }
        }
      },
    });
    albResourcePatch.node.addDependency(albResources);

    // deploy EFS, EFS CSI driver, PV
    const efsCSI = cluster.addChart('EFSCSIDriver', {
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
    cluster.addResource('efs-storageclass',
      {
        kind: 'StorageClass',
        apiVersion: 'storage.k8s.io/v1',
        metadata: {
          name: efsClass,
        },
        provisioner: 'efs.csi.aws.com'
      });
    const efsPV = cluster.addResource('efs-pv', {
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
    var externalDNSResource : eks.KubernetesResource;
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
        request('GET', `${albBaseResourceBaseUrl}external-dns.yaml`)
          .getBody('utf-8').replace('external-dns-test.my-org.com', r53Domain)
          .replace('0.7.1', '0.7.2') // pick external-dns 0.7.2 with Route53 fix in AWS China
          .replace('my-identifier', hostedZone!.hostedZoneId))
          .filter((res: any) => { return res['kind'] != 'ServiceAccount' })
          .map((res: any) => {
            if (res['kind'] === 'ClusterRole') {
              res['rules'].push({
                apiGroups: [''],
                resources: [ 'endpoints' ],
                verbs: ["get","watch","list"]
              });
            } else if (res['kind'] === 'Deployment' && stack.region.startsWith('cn-')) {
              res['spec']['template']['spec']['containers'][0]['env'] = [
                {
                  name: 'AWS_REGION',
                  value: stack.region,
                }
              ];
            }
            return res;
          });

      const externalDNS = cluster.addResource('external-dns', ...externalDNSResources);
      externalDNS.node.addDependency(externalDNSServiceAccount);

      const externalDNSPatch = new eks.KubernetesPatch(this, `external-dns-patch-${albIngressControllerVersion}`, {
        cluster,
        resourceName: "deployment/external-dns",
        resourceNamespace: externalDNSNamespace,
        applyPatch: {
          spec: {
            template: {
              spec: {
                securityContext: {
                  fsGroup: 65534,
                }
              }
            }
          }
        },
        restorePatch: {
          spec: {
            template: {
              spec: {
                securityContext: {
                  fsGroup: 65534,
                }
              }
            }
          }
        },
      });
      externalDNSPatch.node.addDependency(externalDNS);
      externalDNSResource = externalDNSPatch;
    }

    const nexus3ChartName = 'nexus3';
    const nexus3ChartVersion = '2.1.0';
    const nexus3Chart = cluster.addChart('Nexus3', {
      chart: 'sonatype-nexus',
      repository: 'https://oteemo.github.io/charts/',
      namespace: nexus3Namespace,
      release: nexus3ChartName,
      version: nexus3ChartVersion,
      wait: stack.region.startsWith('cn-') ? false : true,
      timeout: stack.region.startsWith('cn-') ? undefined : cdk.Duration.minutes(15),
      values: {
        statefulset: {
          enabled: true,
        },
        nexus: {
          imageTag: '3.23.0',
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
          // name: nexusServiceAccount.serviceAccountName,
        }
      }
    });
    nexus3Chart.node.addDependency(nexusServiceAccount);
    nexus3Chart.node.addDependency(albResourcePatch);
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

    new cdk.CfnOutput(this, 'nexus3-s3-bucket-blobstore', {
      value: `${nexusBlobBucket.bucketName}`,
      description: 'S3 Bucket created for Nexus3 S3 Blobstore'
    });
  }

  private azOfSubnets(subnets: ec2.ISubnet[]) : number {
    return new Set(subnets.map(subnet => subnet.availabilityZone)).size;
  }
}
