import * as cdk from '@aws-cdk/core';
import * as cxapi from '@aws-cdk/cx-api';
import * as mock from './context-provider-mock';
import '@aws-cdk/assert/jest';
import * as SonatypeNexus3 from '../lib/sonatype-nexus3-stack';
import { ResourcePart } from '@aws-cdk/assert/lib/assertions/have-resource';

describe('Nexus OSS stack', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  const vpcId = 'vpc-123456';
  let previous: (scope: cdk.Construct, options: cdk.GetContextValueOptions) => cdk.GetContextValueResult;

  const defaultContext = {
    createNewVpc: true,
    enableR53HostedZone: true,
  };

  beforeAll(() => {
    previous = mock.mockContextProviderWith({
      vpcId,
      vpcCidrBlock: "10.58.0.0/16",
      "subnetGroups": [
        {
          "name": "ingress",
          "type": cxapi.VpcSubnetGroupType.PUBLIC,
          "subnets": [
            {
              "subnetId": "subnet-000f2b20b0ebaef37",
              "cidr": "10.58.0.0/22",
              "availabilityZone": "cn-northwest-1a",
              "routeTableId": "rtb-0f5312df5fe3ae508"
            },
            {
              "subnetId": "subnet-0b2cce92f08506a9a",
              "cidr": "10.58.4.0/22",
              "availabilityZone": "cn-northwest-1b",
              "routeTableId": "rtb-07e969fe93b6edd9a"
            },
            {
              "subnetId": "subnet-0571b340c9f28375c",
              "cidr": "10.58.8.0/22",
              "availabilityZone": "cn-northwest-1c",
              "routeTableId": "rtb-02ae139a60f628b5c"
            }
          ]
        },
        {
          "name": "private",
          "type": cxapi.VpcSubnetGroupType.PRIVATE,
          "subnets": [
            {
              "subnetId": "subnet-0a6dab6bc063ea432",
              "cidr": "10.58.32.0/19",
              "availabilityZone": "cn-northwest-1a",
              "routeTableId": "rtb-0be722c725fd0d29f"
            },
            {
              "subnetId": "subnet-08dd359da55a6160b",
              "cidr": "10.58.64.0/19",
              "availabilityZone": "cn-northwest-1b",
              "routeTableId": "rtb-0b13567ae92b08708"
            },
            {
              "subnetId": "subnet-0d300d086b989eefc",
              "cidr": "10.58.96.0/19",
              "availabilityZone": "cn-northwest-1c",
              "routeTableId": "rtb-08fe9e7932d86517e"
            }
          ]
        }
      ]
    }, options => {
      expect(options.filter).toEqual({
        isDefault: "true",
      });
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
      "Values": {
        "Fn::Join": [
          "",
          [
            "{\"statefulset\":{\"enabled\":true},\"initAdminPassword\":{\"enabled\":true,\"password\":\"",
            {
              "Ref": "NexusAdminInitPassword"
            },
            "\"},\"nexus\":{\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexus"
              ]
            },
            "\",\"resources\":{\"requests\":{\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":false},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"nexusCloudiam\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}, {\\\"HTTPS\\\": 443}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"",
            {
              "Ref": "NexusVpcPublicSubnet1SubnetE9292C67"
            },
            ",",
            {
              "Ref": "NexusVpcPublicSubnet2Subnet4D9CEF81"
            },
            "\",\"alb.ingress.kubernetes.io/certificate-arn\":\"",
            {
              "Ref": "SSLCertificate2E93C565"
            },
            "\",\"alb.ingress.kubernetes.io/ssl-policy\":\"ELBSecurityPolicy-TLS-1-2-Ext-2018-06\",\"alb.ingress.kubernetes.io/actions.ssl-redirect\":\"{\\\"Type\\\": \\\"redirect\\\", \\\"RedirectConfig\\\": { \\\"Protocol\\\": \\\"HTTPS\\\", \\\"Port\\\": \\\"443\\\", \\\"StatusCode\\\": \\\"HTTP_301\\\"}}\"},\"tls\":{\"enabled\":false},\"rules\":[{\"host\":\"",
            {
              "Ref": "DomainName"
            },
            "\",\"http\":{\"paths\":[{\"path\":\"/*\",\"backend\":{\"serviceName\":\"ssl-redirect\",\"servicePort\":\"use-annotation\"}},{\"path\":\"/*\",\"backend\":{\"serviceName\":\"nexus3-sonatype-nexus\",\"servicePort\":8081}}]}},{\"http\":{\"paths\":[{\"path\":\"/*\",\"backend\":{\"serviceName\":\"nexus3-sonatype-nexus\",\"servicePort\":8081}}]}}]},\"serviceAccount\":{\"create\":false}}"
          ]
        ]
      },
      "Release": "nexus3",
      "Chart": "sonatype-nexus",
      "Version": "4.1.1",
      "Namespace": "default",
      "Repository": "https://oteemo.github.io/charts/",
      "Wait": true,
      "Timeout": "900s",
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
    expect(stack).toHaveResourceLike('AWS::CertificateManager::Certificate',{
      "DomainName": {
        "Ref": "DomainName"
      },
      "DomainValidationOptions": [
        {
          "DomainName": {
            "Ref": "DomainName"
          },
          "HostedZoneId": {
            "Ref": "R53HostedZoneId"
          }
        }
      ],
      "ValidationMethod": "DNS",
    });
  });

  test('Create Nexus Stack with new vpc and custom instanceType', () => {
    const context = {
      ...defaultContext,
      instanceType: 'm5.xlarge',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toHaveResource(`AWS::EC2::VPC`,{
      CidrBlock: "10.0.0.0/16",
    });
    expect(stack).toHaveResource(`AWS::EKS::Nodegroup`,{
      InstanceTypes: ["m5.xlarge"]
    });
  });

  test('Enable Nexus3 auto configuration', () => {
    const context = {
      ...defaultContext,
      enableAutoConfigured: true, 
      createNewVpc: false,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Values": {
        "Fn::Join": [
          "",
          [
            "{\"statefulset\":{\"enabled\":true},\"initAdminPassword\":{\"enabled\":true,\"password\":\"",
            {
              "Ref": "NexusAdminInitPassword"
            },
            "\"},\"nexus\":{\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexus"
              ]
            },
            "\",\"resources\":{\"requests\":{\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":false},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"nexusCloudiam\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}, {\\\"HTTPS\\\": 443}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"subnet-000f2b20b0ebaef37,subnet-0b2cce92f08506a9a,subnet-0571b340c9f28375c\",\"alb.ingress.kubernetes.io/certificate-arn\":\"",
            {
              "Ref": "SSLCertificate2E93C565"
            },
            "\",\"alb.ingress.kubernetes.io/ssl-policy\":\"ELBSecurityPolicy-TLS-1-2-Ext-2018-06\",\"alb.ingress.kubernetes.io/actions.ssl-redirect\":\"{\\\"Type\\\": \\\"redirect\\\", \\\"RedirectConfig\\\": { \\\"Protocol\\\": \\\"HTTPS\\\", \\\"Port\\\": \\\"443\\\", \\\"StatusCode\\\": \\\"HTTP_301\\\"}}\"},\"tls\":{\"enabled\":false},\"rules\":[{\"host\":\"",
            {
              "Ref": "DomainName"
            },
            "\",\"http\":{\"paths\":[{\"path\":\"/*\",\"backend\":{\"serviceName\":\"ssl-redirect\",\"servicePort\":\"use-annotation\"}},{\"path\":\"/*\",\"backend\":{\"serviceName\":\"nexus3-sonatype-nexus\",\"servicePort\":8081}}]}},{\"http\":{\"paths\":[{\"path\":\"/*\",\"backend\":{\"serviceName\":\"nexus3-sonatype-nexus\",\"servicePort\":8081}}]}}]},\"serviceAccount\":{\"create\":false},\"config\":{\"enabled\":true,\"data\":{\"nexus.properties\":\"nexus.scripts.allowCreation=true\"}},\"deployment\":{\"additionalVolumeMounts\":[{\"mountPath\":\"/nexus-data/etc/nexus.properties\",\"subPath\":\"nexus.properties\",\"name\":\"sonatype-nexus-conf\"}]}}"
          ]
        ]
      }
    });
  
    expect(stack).toHaveResource('Custom::Nexus3-AutoConfigure', {
      "Properties": {
        "ServiceToken": {
          "Fn::GetAtt": [
            "Neuxs3AutoCofingureE91D0A63",
            "Arn"
          ]
        },
        "Username": "admin",
        "Password": {
          "Ref": "NexusAdminInitPassword",
        },
        "Endpoint": {
          "Fn::Join": [
            "",
            [
              "http://",
              {
                "Fn::GetAtt": [
                  "Nexus3ALBAddress17C0552F",
                  "Value"
                ]
              }
            ]
          ]
        },
        "S3BucketName": {
          "Ref": "nexus3blobstore00DDADD3"
        }
      },
      "DependsOn": [
        "NexusClusterchartNexus37BADE970"
      ],
    }, ResourcePart.CompleteDefinition);
  });

  test('AWS load baalancer controller helm chart is created', () => {
    const context = {
      ...defaultContext,
      createNewVpc: false,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));
    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Release": "aws-load-balancer-controller",
      "Chart": "aws-load-balancer-controller",
      "Version": "1.1.0",
      "Repository": "https://aws.github.io/eks-charts",
    });
  });

  test('External dns resource is created when r53Domain is specified.', () => {
    const context = {
      ...defaultContext,
      createNewVpc: false,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context, {
      account: '123456789012',
      region: 'cn-north-1',
    }));

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-KubernetesResource', {
      "Manifest": {
        "Fn::Join": [
          "",
          [
            "[{\"apiVersion\":\"v1\",\"kind\":\"ServiceAccount\",\"metadata\":{\"name\":\"external-dns\",\"namespace\":\"default\",\"labels\":{\"aws.cdk.eks/prune-c85512b0f3c9c03a9294d46c98f9f1357963ae570e\":\"\",\"app.kubernetes.io/name\":\"external-dns\"},\"annotations\":{\"eks.amazonaws.com/role-arn\":\"",
            {
              "Fn::GetAtt": [
                "NexusClusterexternaldnsRole25A6F41E",
                "Arn"
              ]
            },
            "\"}}}]"
          ]
        ]
      },
    });
  });

  test('correct dependencies for deleting stack', () => {
    // retain custom data after deleting stack
    expect(stack).toHaveResourceLike('AWS::EFS::FileSystem', {
      "UpdateReplacePolicy": "Retain",
      "DeletionPolicy": "Retain",
    }, ResourcePart.CompleteDefinition);

    // explicitly remove the sg of EFS for deleting the VPC
    expect(stack).toHaveResourceLike('AWS::EC2::SecurityGroup', {
      "Properties": {
        "SecurityGroupIngress": [
          {
            "CidrIp": {
              "Fn::GetAtt": [
                "NexusVpc88FCF4B5",
                "CidrBlock"
              ]
            },
            "Description": "allow access efs from inside vpc",
            "FromPort": 2049,
            "IpProtocol": "tcp",
            "ToPort": 2049
          }
        ],
      },
      "UpdateReplacePolicy": "Delete",
      "DeletionPolicy": "Delete",
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::Neuxs3-Purge', {
      "Properties": {
        "ClusterName": {
          "Ref": "NexusCluster2168A4B1"
        },
        "RoleArn": {
          "Fn::GetAtt": [
            "NexusClusterCreationRole5D1FBB93",
            "Arn"
          ]
        },
        "ObjectType": "ingress",
        "ObjectName": "nexus3-sonatype-nexus",
        "ObjectNamespace": "default",
        "JsonPath": ".status.loadBalancer.ingress[0].hostname",
        "TimeoutSeconds": 360,
        "Release": "nexus3",
      },
      "DependsOn": [
        "NexusClusterchartAWSLoadBalancerController06E2710B",
        "NexusClustermanifestefspv19E0A105"
      ],
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Properties": {
        "Release": "nexus3",
        "Chart": "sonatype-nexus",
      },
      "DependsOn": [
        "Neuxs3PurgeCR",
        "NexusClusterKubectlReadyBarrier6571FFC0",
        "NexusClustermanifestexternaldns8C93099A",
        "NexusClustersonatypenexus3ConditionJsonBA718515",
        "NexusClustersonatypenexus3manifestsonatypenexus3ServiceAccountResourceDA1D0F12",
        "NexusClustersonatypenexus3RoleDefaultPolicy0CF1CA3B",
        "NexusClustersonatypenexus3RoleFE3455FB",
        "SSLCertificate2E93C565"
      ],
    }, ResourcePart.CompleteDefinition);
  });

  test('the encryption configuration of storages.', () => {
    expect(stack).toHaveResourceLike('AWS::S3::Bucket', {
      "BucketEncryption": {
        "ServerSideEncryptionConfiguration": [
          {
            "ServerSideEncryptionByDefault": {
              "SSEAlgorithm": "AES256"
            }
          }
        ]
      },
    });

    expect(stack).toHaveResourceLike('AWS::EFS::FileSystem', {
      "Encrypted": true,
    });
  });

  test('deploy alb as interal.', () => {
    const context = {
      internalALB: true,
      enableR53HostedZone: true,
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toCountResources('AWS::CertificateManager::Certificate', 0);

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Release": "nexus3",
      "Values": {
        "Fn::Join": [
          "",
          [
            "{\"statefulset\":{\"enabled\":true},\"initAdminPassword\":{\"enabled\":true,\"password\":\"",
            {
              "Ref": "NexusAdminInitPassword"
            },
            "\"},\"nexus\":{\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexus"
              ]
            },
            "\",\"resources\":{\"requests\":{\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":false},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"nexusCloudiam\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}]\",\"alb.ingress.kubernetes.io/scheme\":\"internal\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"10.58.0.0/16\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"subnet-000f2b20b0ebaef37,subnet-0b2cce92f08506a9a,subnet-0571b340c9f28375c\"},\"tls\":{\"enabled\":false},\"rules\":[{\"http\":{\"paths\":[{\"path\":\"/*\",\"backend\":{\"serviceName\":\"nexus3-sonatype-nexus\",\"servicePort\":8081}}]}}]},\"serviceAccount\":{\"create\":false}}"
          ]
        ]
      },
    });
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