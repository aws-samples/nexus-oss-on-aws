import { ResourcePart } from '@aws-cdk/assert/lib/assertions/have-resource';
import * as cdk from '@aws-cdk/core';
import * as cxapi from '@aws-cdk/cx-api';
import * as SonatypeNexus3 from '../src/lib/sonatype-nexus3-stack';
import * as mock from './context-provider-mock';
import '@aws-cdk/assert/jest';

describe('Nexus OSS stack', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  const vpcId = 'vpc-123456';
  let previous: (scope: cdk.Construct, options: cdk.GetContextValueOptions) => cdk.GetContextValueResult;

  const defaultContext = {
    enableR53HostedZone: true,
  };

  beforeAll(() => {
    previous = mock.mockContextProviderWith({
      vpcId,
      vpcCidrBlock: '10.58.0.0/16',
      subnetGroups: [
        {
          name: 'ingress',
          type: cxapi.VpcSubnetGroupType.PUBLIC,
          subnets: [
            {
              subnetId: 'subnet-000f2b20b0ebaef37',
              cidr: '10.58.0.0/22',
              availabilityZone: 'cn-northwest-1a',
              routeTableId: 'rtb-0f5312df5fe3ae508',
            },
            {
              subnetId: 'subnet-0b2cce92f08506a9a',
              cidr: '10.58.4.0/22',
              availabilityZone: 'cn-northwest-1b',
              routeTableId: 'rtb-07e969fe93b6edd9a',
            },
            {
              subnetId: 'subnet-0571b340c9f28375c',
              cidr: '10.58.8.0/22',
              availabilityZone: 'cn-northwest-1c',
              routeTableId: 'rtb-02ae139a60f628b5c',
            },
          ],
        },
        {
          name: 'private',
          type: cxapi.VpcSubnetGroupType.PRIVATE,
          subnets: [
            {
              subnetId: 'subnet-0a6dab6bc063ea432',
              cidr: '10.58.32.0/19',
              availabilityZone: 'cn-northwest-1a',
              routeTableId: 'rtb-0be722c725fd0d29f',
            },
            {
              subnetId: 'subnet-08dd359da55a6160b',
              cidr: '10.58.64.0/19',
              availabilityZone: 'cn-northwest-1b',
              routeTableId: 'rtb-0b13567ae92b08708',
            },
            {
              subnetId: 'subnet-0d300d086b989eefc',
              cidr: '10.58.96.0/19',
              availabilityZone: 'cn-northwest-1c',
              routeTableId: 'rtb-08fe9e7932d86517e',
            },
          ],
        },
      ],
    }, _options => {
    });
  });

  afterAll(() => {
    mock.restoreContextProvider(previous);
  });

  beforeEach(() => {
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, defaultContext));
  });

  test('Nexus Stack is created', () => {
    expect(stack).toHaveResourceLike('AWS::CloudFormation::Stack', {
    });

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      Values: {
        'Fn::Join': [
          '',
          [
            '{"statefulset":{"enabled":true},"initAdminPassword":{"enabled":true,"password":"',
            {
              Ref: 'NexusAdminInitPassword',
            },
            '"},"nexus":{"imageName":"',
            {
              'Fn::FindInMap': [
                'PartitionMapping',
                {
                  Ref: 'AWS::Partition',
                },
                'nexus',
              ],
            },
            '","resources":{"requests":{"memory":"4800Mi"}},"livenessProbe":{"path":"/"}},"nexusProxy":{"enabled":false},"persistence":{"enabled":true,"storageClass":"efs-sc","accessMode":"ReadWriteMany"},"nexusBackup":{"enabled":false,"persistence":{"enabled":false}},"nexusCloudiam":{"enabled":false,"persistence":{"enabled":false}},"ingress":{"enabled":true,"path":"/*","annotations":{"alb.ingress.kubernetes.io/backend-protocol":"HTTP","alb.ingress.kubernetes.io/healthcheck-path":"/","alb.ingress.kubernetes.io/healthcheck-port":8081,"alb.ingress.kubernetes.io/listen-ports":"[{\"HTTP\": 80}]","alb.ingress.kubernetes.io/scheme":"internet-facing","alb.ingress.kubernetes.io/inbound-cidrs":"0.0.0.0/0","alb.ingress.kubernetes.io/auth-type":"none","alb.ingress.kubernetes.io/target-type":"ip","kubernetes.io/ingress.class":"alb","alb.ingress.kubernetes.io/tags":"app=nexus3","alb.ingress.kubernetes.io/subnets":"',
            {
              Ref: 'NexusOSSVpcPublicSubnet1SubnetE287B3FC',
            },
            ',',
            {
              Ref: 'NexusOSSVpcPublicSubnet2Subnet8D595BFF',
            },
            '","alb.ingress.kubernetes.io/load-balancer-attributes":"access_logs.s3.enabled=true,access_logs.s3.bucket=',
            {
              Ref: 'LogBucketCC3B17E8',
            },
            ',access_logs.s3.prefix=albAccessLog"},"tls":{"enabled":false},"rules":[{"http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"nexus3-sonatype-nexus","port":{"number":8081}}}}]}}]},"serviceAccount":{"create":false}}'
          
          ],
        ],
      },
      Release: 'nexus3',
      Chart: 'sonatype-nexus',
      Version: '5.4.0',
      Namespace: 'default',
      Repository: {
        'Fn::FindInMap': [
          'PartitionMapping',
          {
            Ref: 'AWS::Partition',
          },
          'nexusHelmChartRepo',
        ],
      },
      Wait: true,
      Timeout: '900s',
    });
  });

  test('eks cluster is created with proper configuration', () => {
    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-Cluster', {
      Config: {
        version: {
          Ref: 'KubernetesVersion',
        },
        roleArn: {
          'Fn::GetAtt': [
            'NexusClusterRole08D74DFC',
            'Arn',
          ],
        },
        resourcesVpcConfig: {
          subnetIds: [
            {
              Ref: 'NexusOSSVpcPublicSubnet1SubnetE287B3FC',
            },
            {
              Ref: 'NexusOSSVpcPublicSubnet2Subnet8D595BFF',
            },
            {
              Ref: 'NexusOSSVpcPrivateSubnet1SubnetEFE22FB8',
            },
            {
              Ref: 'NexusOSSVpcPrivateSubnet2Subnet8A12FC8A',
            },
          ],
          securityGroupIds: [
            {
              'Fn::GetAtt': [
                'NexusClusterControlPlaneSecurityGroupBC441028',
                'GroupId',
              ],
            },
          ],
          endpointPublicAccess: false,
          endpointPrivateAccess: true,
        },
      },
    });
  });

  test('ssl certificate with R53 hosted zone when disabling R53 hosted zone', () => {
    const context = {
      enableR53HostedZone: false,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toCountResources('AWS::CertificateManager::Certificate', 0);
  });

  test('ssl certificate with R53 hosted zone when enabling R53 hosted zone', () => {
    expect(stack).toHaveResourceLike('AWS::CertificateManager::Certificate', {
      DomainName: {
        Ref: 'DomainName',
      },
      DomainValidationOptions: [
        {
          DomainName: {
            Ref: 'DomainName',
          },
          HostedZoneId: {
            Ref: 'R53HostedZoneId',
          },
        },
      ],
      ValidationMethod: 'DNS',
    });
  });

  test('Create Nexus Stack with new vpc and custom instanceType', () => {
    const context = {
      ...defaultContext,
      instanceType: 'm5.xlarge',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toHaveResource('AWS::EC2::VPC', {
      CidrBlock: '10.0.0.0/16',
    });

    expect(stack).toHaveResourceLike('AWS::EC2::LaunchTemplate', {
      LaunchTemplateData: {
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              Encrypted: true,
              VolumeSize: 30,
            },
          },
        ],
        Monitoring: {
          Enabled: true,
        },
      },
    });
    expect(stack).toHaveResourceLike('AWS::EKS::Nodegroup', {
      InstanceTypes: ['m5.xlarge'],
      LaunchTemplate: {
        Id: {
          Ref: 'EKSManagedNodeTemplate423DB07D',
        },
      },
    });
  });

  test('Enable Nexus3 auto configuration', () => {
    const context = {
      ...defaultContext,
      enableAutoConfigured: true,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      Values: {
        'Fn::Join': [
          '',
          [
            '{"statefulset":{"enabled":true},"initAdminPassword":{"enabled":true,"password":"',
            {
              Ref: 'NexusAdminInitPassword',
            },
            '"},"nexus":{"imageName":"',
            {
              'Fn::FindInMap': [
                'PartitionMapping',
                {
                  Ref: 'AWS::Partition',
                },
                'nexus',
              ],
            },
            '","resources":{"requests":{"memory":"4800Mi"}},"livenessProbe":{"path":"/"}},"nexusProxy":{"enabled":false},"persistence":{"enabled":true,"storageClass":"efs-sc","accessMode":"ReadWriteMany"},"nexusBackup":{"enabled":false,"persistence":{"enabled":false}},"nexusCloudiam":{"enabled":false,"persistence":{"enabled":false}},"ingress":{"enabled":true,"path":"/*","annotations":{"alb.ingress.kubernetes.io/backend-protocol":"HTTP","alb.ingress.kubernetes.io/healthcheck-path":"/","alb.ingress.kubernetes.io/healthcheck-port":8081,"alb.ingress.kubernetes.io/listen-ports":"[{\"HTTP\": 80}]","alb.ingress.kubernetes.io/scheme":"internet-facing","alb.ingress.kubernetes.io/inbound-cidrs":"0.0.0.0/0","alb.ingress.kubernetes.io/auth-type":"none","alb.ingress.kubernetes.io/target-type":"ip","kubernetes.io/ingress.class":"alb","alb.ingress.kubernetes.io/tags":"app=nexus3","alb.ingress.kubernetes.io/subnets":"',
            {
              Ref: 'NexusOSSVpcPublicSubnet1SubnetE287B3FC',
            },
            ',',
            {
              Ref: 'NexusOSSVpcPublicSubnet2Subnet8D595BFF',
            },
            '","alb.ingress.kubernetes.io/load-balancer-attributes":"access_logs.s3.enabled=true,access_logs.s3.bucket=',
            {
              Ref: 'LogBucketCC3B17E8',
            },
            ',access_logs.s3.prefix=albAccessLog"},"tls":{"enabled":false},"rules":[{"http":{"paths":[{"path":"/","pathType":"Prefix","backend":{"service":{"name":"nexus3-sonatype-nexus","port":{"number":8081}}}}]}}]},"serviceAccount":{"create":false}}'
          ],
        ],
      },
    });

    expect(stack).toHaveResource('Custom::Nexus3-AutoConfigure', {
      Properties: {
        ServiceToken: {
          'Fn::GetAtt': [
            'Neuxs3AutoCofingureE91D0A63',
            'Arn',
          ],
        },
        Username: 'admin',
        Password: {
          Ref: 'NexusAdminInitPassword',
        },
        Endpoint: {
          'Fn::Join': [
            '',
            [
              'http://',
              {
                'Fn::GetAtt': [
                  'Nexus3ALBAddress17C0552F',
                  'Value',
                ],
              },
            ],
          ],
        },
        S3BucketName: {
          Ref: 'nexus3blobstore00DDADD3',
        },
      },
      DependsOn: [
        'NexusClusterchartNexus37BADE970',
      ],
      Condition: 'EKSV119',
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::LogRetention', {
      Properties: {
        LogGroupName: {
          'Fn::Join': [
            '',
            [
              '/aws/lambda/',
              {
                Ref: 'Neuxs3AutoCofingureE91D0A63',
              },
            ],
          ],
        },
      },
      Condition: 'EKSV119',
    }, ResourcePart.CompleteDefinition);
  });

  test('AWS load baalancer controller helm chart is created', () => {
    const context = {
      ...defaultContext,
      vpcId: 'default',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));
    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      Release: 'aws-load-balancer-controller',
      Chart: 'aws-load-balancer-controller',
      Version: '1.4.1',
      Repository: {
        'Fn::FindInMap': [
          'PartitionMapping',
          {
            Ref: 'AWS::Partition',
          },
          'albHelmChartRepo',
        ],
      },
    });
  });

  test('External dns resource is created when r53Domain is specified.', () => {
    const context = {
      ...defaultContext,
      vpcId: 'default',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-KubernetesResource', {
      Manifest: {
        'Fn::Join': [
          '',
          [
            '[{"apiVersion":"v1","kind":"ServiceAccount","metadata":{"name":"external-dns","namespace":"default","labels":{"aws.cdk.eks/prune-c85512b0f3c9c03a9294d46c98f9f1357963ae570e":"","app.kubernetes.io/name":"external-dns"},"annotations":{"eks.amazonaws.com/role-arn":"',
            {
              'Fn::GetAtt': [
                'NexusClusterexternaldnsRole25A6F41E',
                'Arn',
              ],
            },
            '"}}}]',
          ],
        ],
      },
    });
  });

  test('custom purge lambda is expected', () => {
    // must use runtime py_37 for awscli 1.x support
    // must have env 'AWS_STS_REGIONAL_ENDPOINTS' for some regions, such as ap-east-1
    expect(stack).toHaveResourceLike('AWS::Lambda::Function', {
      Environment: {
        Variables: {
          AWS_STS_REGIONAL_ENDPOINTS: 'regional',
        },
      },
      Handler: 'index.handler',
      Layers: [
        {
          Ref: 'AwsCliLayerF44AAF94',
        },
        {
          Ref: 'KubectlLayer600207B5',
        },
      ],
      Runtime: 'python3.7',
    });
  });

  test('correct dependencies for deleting stack', () => {
    // retain custom data after deleting stack
    expect(stack).toHaveResourceLike('AWS::EFS::FileSystem', {
      UpdateReplacePolicy: 'Retain',
      DeletionPolicy: 'Retain',
    }, ResourcePart.CompleteDefinition);

    // explicitly remove the sg of EFS for deleting the VPC
    expect(stack).toHaveResourceLike('AWS::EC2::SecurityGroup', {
      Properties: {
        SecurityGroupIngress: [
          {
            CidrIp: {
              'Fn::GetAtt': [
                'NexusOSSVpc94CE3B74',
                'CidrBlock',
              ],
            },
            Description: 'allow access efs from inside vpc',
            FromPort: 2049,
            IpProtocol: 'tcp',
            ToPort: 2049,
          },
        ],
      },
      UpdateReplacePolicy: 'Delete',
      DeletionPolicy: 'Delete',
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::Nexus3-Purge', {
      Properties: {
        ClusterName: {
          Ref: 'NexusCluster2168A4B1',
        },
        RoleArn: {
          'Fn::GetAtt': [
            'NexusClusterCreationRole5D1FBB93',
            'Arn',
          ],
        },
        ObjectType: 'ingress',
        ObjectName: 'nexus3-sonatype-nexus',
        ObjectNamespace: 'default',
        JsonPath: '.status.loadBalancer.ingress[0].hostname',
        TimeoutSeconds: 360,
        Release: 'nexus3',
      },
      DependsOn: [
        'NexusClusterchartAWSLoadBalancerController06E2710B',
        'NexusClustermanifestefspv19E0A105',
      ],
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      Properties: {
        Release: 'nexus3',
        Chart: 'sonatype-nexus',
      },
      DependsOn: [
        'Nexus3PurgeCR',
        'NexusClusterKubectlReadyBarrier6571FFC0',
        'NexusClustermanifestexternaldns8C93099A',
        'NexusClustersonatypenexus3ConditionJsonBA718515',
        'NexusClustersonatypenexus3manifestsonatypenexus3ServiceAccountResourceDA1D0F12',
        'NexusClustersonatypenexus3RoleDefaultPolicy0CF1CA3B',
        'NexusClustersonatypenexus3RoleFE3455FB',
        'SSLCertificate2E93C565',
      ],
    }, ResourcePart.CompleteDefinition);
  });

  test('the encryption configuration of storages.', () => {
    expect(stack).toHaveResourceLike('AWS::S3::Bucket', {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
    });

    expect(stack).toHaveResourceLike('AWS::EFS::FileSystem', {
      Encrypted: true,
    });
  });

  test('bucket policy of log bucket, including, access log of ALB created by AWS load balancer controller, vpc flow logs.', () => {
    expect(stack).toHaveResourceLike('AWS::S3::BucketPolicy', {
      Bucket: {
        Ref: 'LogBucketCC3B17E8',
      },
      PolicyDocument: {
        Statement: [
          {
            Action: 's3:PutObject',
            Condition: {
              StringEquals: {
                's3:x-amz-acl': 'bucket-owner-full-control',
              },
            },
            Effect: 'Allow',
            Principal: {
              Service: 'delivery.logs.amazonaws.com',
            },
            Resource: {
              'Fn::Join': [
                '',
                [
                  {
                    'Fn::GetAtt': [
                      'LogBucketCC3B17E8',
                      'Arn',
                    ],
                  },
                  '/vpcFlowLogs/AWSLogs/',
                  {
                    Ref: 'AWS::AccountId',
                  },
                  '/*',
                ],
              ],
            },
            Sid: 'AWSLogDeliveryWrite',
          },
          {
            Action: [
              's3:GetBucketAcl',
              's3:ListBucket',
            ],
            Effect: 'Allow',
            Principal: {
              Service: 'delivery.logs.amazonaws.com',
            },
            Resource: {
              'Fn::GetAtt': [
                'LogBucketCC3B17E8',
                'Arn',
              ],
            },
            Sid: 'AWSLogDeliveryCheck',
          },
          {
            Action: [
              's3:PutObject*',
              's3:Abort*',
            ],
            Effect: 'Allow',
            Principal: {
              AWS: {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {
                      Ref: 'AWS::Partition',
                    },
                    ':iam::',
                    {
                      'Fn::FindInMap': [
                        'ALBServiceAccountMapping',
                        {
                          Ref: 'AWS::Region',
                        },
                        'account',
                      ],
                    },
                    ':root',
                  ],
                ],
              },
            },
            Resource: {
              'Fn::Join': [
                '',
                [
                  {
                    'Fn::GetAtt': [
                      'LogBucketCC3B17E8',
                      'Arn',
                    ],
                  },
                  '/albAccessLog/AWSLogs/',
                  {
                    Ref: 'AWS::AccountId',
                  },
                  '/*',
                ],
              ],
            },
          },
        ],
      },
    });
  });

  test('deploy alb as interal.', () => {
    const context = {
      ...defaultContext,
      internalALB: true,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toCountResources('AWS::CertificateManager::Certificate', 0);

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      Release: 'nexus3',
      Values: {
        'Fn::Join': [
          '',
          [
            '{"statefulset":{"enabled":true},"initAdminPassword":{"enabled":true,"password":"',
            {
              Ref: 'NexusAdminInitPassword',
            },
            '"},"nexus":{"imageName":"',
            {
              'Fn::FindInMap': [
                'PartitionMapping',
                {
                  Ref: 'AWS::Partition',
                },
                'nexus',
              ],
            },
            '","resources":{"requests":{"memory":"4800Mi"}},"livenessProbe":{"path":"/"}},"nexusProxy":{"enabled":false},"persistence":{"enabled":true,"storageClass":"efs-sc","accessMode":"ReadWriteMany"},"nexusBackup":{"enabled":false,"persistence":{"enabled":false}},"nexusCloudiam":{"enabled":false,"persistence":{"enabled":false}},"ingress":{"enabled":true,"path":"/*","annotations":{"alb.ingress.kubernetes.io/backend-protocol":"HTTP","alb.ingress.kubernetes.io/healthcheck-path":"/","alb.ingress.kubernetes.io/healthcheck-port":8081,"alb.ingress.kubernetes.io/listen-ports":"[{\\"HTTP\\": 80}]","alb.ingress.kubernetes.io/scheme":"internal","alb.ingress.kubernetes.io/inbound-cidrs":"',
            {
              'Fn::GetAtt': [
                'NexusOSSVpc94CE3B74',
                'CidrBlock',
              ],
            },
            '","alb.ingress.kubernetes.io/auth-type":"none","alb.ingress.kubernetes.io/target-type":"ip","kubernetes.io/ingress.class":"alb","alb.ingress.kubernetes.io/tags":"app=nexus3","alb.ingress.kubernetes.io/subnets":"',
            {
              Ref: 'NexusOSSVpcPublicSubnet1SubnetE287B3FC',
            },
            ',',
            {
              Ref: 'NexusOSSVpcPublicSubnet2Subnet8D595BFF',
            },
            '","alb.ingress.kubernetes.io/load-balancer-attributes":"access_logs.s3.enabled=true,access_logs.s3.bucket=',
            {
              Ref: 'LogBucketCC3B17E8',
            },
            ',access_logs.s3.prefix=albAccessLog"},"tls":{"enabled":false},"rules":[{"http":{"paths":[{"path":"/*","backend":{"serviceName":"nexus3-sonatype-nexus","servicePort":8081}}]}}]},"serviceAccount":{"create":false}}',
          ],
        ],
      },
    });
  });

  test('deploy to existing eks cluster.', () => {
    const context = {
      ...defaultContext,
      importedEKS: true,
      vpcId: 'vpc-12345',
      eksClusterName: 'eks-cluster',
      eksKubectlRoleArn: 'arn:aws-cn:iam::123456789012:role/eks-kubectl-role',
      eksOpenIdConnectProviderArn: 'arn:aws-cn:iam::123456789012:oidc-provider/oidc.eks.cn-north-1.amazonaws.cn/id/123456789',
      nodeGroupRoleArn: 'arn:aws-cn:iam::123456789012:role/eksctl-cluster-nodegroup-ng-NodeInstanceRole-123456',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));

    expect(stack).toCountResources('Custom::AWSCDK-EKS-Cluster', 0);
    expect(stack).toCountResources('AWS::EKS::Nodegroup', 0);
  });

});

function initializeStackWithContextsAndEnvs(app: cdk.App, stack: cdk.Stack,
  context: {} | undefined, env?: {} | undefined) {
  app = new cdk.App({
    context,
  });

  stack = new SonatypeNexus3.SonatypeNexus3Stack(app, 'NexusStack', {
    env: env,
  });
  return { app, stack };
}
