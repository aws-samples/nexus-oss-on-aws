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
            "{\"statefulset\":{\"enabled\":true},\"nexus\":{\"imageTag\":\"3.23.0\",\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexus"
              ]
            },
            "\",\"resources\":{\"requests\":{\"cpu\":\"256m\",\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":true,\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexusProxy"
              ]
            },
            "\",\"port\":8081,\"env\":{\"nexusHttpHost\":\"",
            {
              "Ref": "domainName"
            },
            "\"}},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}, {\\\"HTTPS\\\": 443}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"",
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
            "\",\"alb.ingress.kubernetes.io/ssl-policy\":\"ELBSecurityPolicy-TLS-1-2-Ext-2018-06\",\"alb.ingress.kubernetes.io/actions.ssl-redirect\":\"{\\\"Type\\\": \\\"redirect\\\", \\\"RedirectConfig\\\": { \\\"Protocol\\\": \\\"HTTPS\\\", \\\"Port\\\": \\\"443\\\", \\\"StatusCode\\\": \\\"HTTP_301\\\"}}\"},\"tls\":{\"enabled\":false}},\"serviceAccount\":{\"create\":false}}"
          ]
        ]
      },
      "Release": "nexus3",
      "Chart": "sonatype-nexus",
      "Version": "2.1.0",
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
        "Ref": "domainName"
      },
      "DomainValidationOptions": [
        {
          "DomainName": {
            "Ref": "domainName"
          },
          "HostedZoneId": {
            "Ref": "r53HostedZoneId"
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
            "{\"statefulset\":{\"enabled\":true},\"nexus\":{\"imageTag\":\"3.23.0\",\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexus"
              ]
            },
            "\",\"resources\":{\"requests\":{\"cpu\":\"256m\",\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":true,\"imageName\":\"",
            {
              "Fn::FindInMap": [
                "PartitionMapping",
                {
                  "Ref": "AWS::Partition"
                },
                "nexusProxy"
              ]
            },
            "\",\"port\":8081,\"env\":{\"nexusHttpHost\":\"",
            {
              "Ref": "domainName"
            },
            "\"}},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}, {\\\"HTTPS\\\": 443}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"subnet-000f2b20b0ebaef37,subnet-0b2cce92f08506a9a,subnet-0571b340c9f28375c\",\"alb.ingress.kubernetes.io/certificate-arn\":\"",
            {
              "Ref": "SSLCertificate2E93C565"
            },
            "\",\"alb.ingress.kubernetes.io/ssl-policy\":\"ELBSecurityPolicy-TLS-1-2-Ext-2018-06\",\"alb.ingress.kubernetes.io/actions.ssl-redirect\":\"{\\\"Type\\\": \\\"redirect\\\", \\\"RedirectConfig\\\": { \\\"Protocol\\\": \\\"HTTPS\\\", \\\"Port\\\": \\\"443\\\", \\\"StatusCode\\\": \\\"HTTP_301\\\"}}\"},\"tls\":{\"enabled\":false}},\"serviceAccount\":{\"create\":false},\"config\":{\"enabled\":true,\"data\":{\"nexus.properties\":\"nexus.scripts.allowCreation=true\"}},\"deployment\":{\"additionalVolumeMounts\":[{\"mountPath\":\"/nexus-data/etc/nexus.properties\",\"subPath\":\"nexus.properties\",\"name\":\"sonatype-nexus-conf\"}]}}"
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
        "Password": "admin123",
        "Endpoint": {
          "Fn::Join": [
            "",
            [
              "https://",
              {
                "Ref": "domainName"
              }
            ]
          ]
        },
        "S3BucketName": {
          "Ref": "nexus3blobstore00DDADD3"
        }
      },
      "DependsOn": [
        "MyK8SClusterchartNexus321315D47"
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
      "Version": "1.0.8",
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
            "[{\"apiVersion\":\"rbac.authorization.k8s.io/v1beta1\",\"kind\":\"ClusterRole\",\"metadata\":{\"name\":\"external-dns\",\"labels\":{\"aws.cdk.eks/prune-c8849b69f7ad812f2fdf537515a65251b0219915b5\":\"\"}},\"rules\":[{\"apiGroups\":[\"\"],\"resources\":[\"services\"],\"verbs\":[\"get\",\"watch\",\"list\"]},{\"apiGroups\":[\"\"],\"resources\":[\"pods\"],\"verbs\":[\"get\",\"watch\",\"list\"]},{\"apiGroups\":[\"extensions\"],\"resources\":[\"ingresses\"],\"verbs\":[\"get\",\"watch\",\"list\"]},{\"apiGroups\":[\"\"],\"resources\":[\"nodes\"],\"verbs\":[\"list\"]},{\"apiGroups\":[\"\"],\"resources\":[\"endpoints\"],\"verbs\":[\"get\",\"watch\",\"list\"]}]},{\"apiVersion\":\"rbac.authorization.k8s.io/v1beta1\",\"kind\":\"ClusterRoleBinding\",\"metadata\":{\"name\":\"external-dns-viewer\",\"labels\":{\"aws.cdk.eks/prune-c8849b69f7ad812f2fdf537515a65251b0219915b5\":\"\"}},\"roleRef\":{\"apiGroup\":\"rbac.authorization.k8s.io\",\"kind\":\"ClusterRole\",\"name\":\"external-dns\"},\"subjects\":[{\"kind\":\"ServiceAccount\",\"name\":\"external-dns\",\"namespace\":\"default\"}]},{\"apiVersion\":\"apps/v1\",\"kind\":\"Deployment\",\"metadata\":{\"name\":\"external-dns\",\"labels\":{\"aws.cdk.eks/prune-c8849b69f7ad812f2fdf537515a65251b0219915b5\":\"\"}},\"spec\":{\"selector\":{\"matchLabels\":{\"app\":\"external-dns\"}},\"strategy\":{\"type\":\"Recreate\"},\"template\":{\"metadata\":{\"labels\":{\"app\":\"external-dns\"}},\"spec\":{\"serviceAccountName\":\"external-dns\",\"containers\":[{\"name\":\"external-dns\",\"image\":\"bitnami/external-dns:0.7.4\",\"args\":[\"--source=service\",\"--source=ingress\",\"--domain-filter=\",\"--provider=aws\",\"--policy=upsert-only\",\"--aws-zone-type=public\",\"--registry=txt\",\"--txt-owner-id=nexus3\"],\"env\":[{\"name\":\"AWS_REGION\",\"value\":\"",
            {
              "Ref": "AWS::Region"
            },
            "\"}]}],\"securityContext\":{\"fsGroup\":65534}}}}}]"
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
          "Ref": "MyK8SCluster2BC9D7DF"
        },
        "RoleArn": {
          "Fn::GetAtt": [
            "MyK8SClusterCreationRole80A92DA5",
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
        "MyK8SClusterchartAWSLoadBalancerController3478DFA7",
        "MyK8SClustermanifestefspv625E8547"
      ],
    }, ResourcePart.CompleteDefinition);

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Properties": {
        "Release": "nexus3",
        "Chart": "sonatype-nexus",
      },
      "DependsOn": [
        "MyK8SClusterKubectlReadyBarrier293D109D",
        "MyK8SClustermanifestexternaldns9FE6660B",
        "MyK8SClustersonatypenexus3ConditionJsonD1595E3D",
        "MyK8SClustersonatypenexus3manifestsonatypenexus3ServiceAccountResource4C5853D6",
        "MyK8SClustersonatypenexus3RoleDefaultPolicy29290195",
        "MyK8SClustersonatypenexus3Role37C11172",
        "Neuxs3PurgeCR",
        "SSLCertificate2E93C565"
      ],
    }, ResourcePart.CompleteDefinition);
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