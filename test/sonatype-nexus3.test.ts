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
    const context = {
      domainName: 'example.com',
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));
  });

  test('Nexus Stack is created', () => {
    expect(stack).toHaveResourceLike('AWS::CloudFormation::Stack', {
    });

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Values": "{\"statefulset\":{\"enabled\":true},\"nexus\":{\"imageTag\":\"3.23.0\",\"resources\":{\"requests\":{\"cpu\":\"256m\",\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":true,\"port\":8081,\"env\":{\"nexusHttpHost\":\"example.com\"}},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"subnet-000f2b20b0ebaef37,subnet-0b2cce92f08506a9a,subnet-0571b340c9f28375c\"},\"tls\":{\"enabled\":false}},\"serviceAccount\":{\"create\":false}}",
      "Release": "nexus3",
      "Chart": "sonatype-nexus",
      "Version": "2.1.0",
      "Namespace": "default",
      "Repository": "https://oteemo.github.io/charts/",
    });
  });

  test('Create Nexus Stack with new vpc and custom instanceType', () => {
    // not mocking vpc provider when creating a new vpc 
    mock.restoreContextProvider(previous);
    
    const context = {
      domainName: 'example.com',
      instanceType: 'm5.xlarge',
      createNewVpc: true, 
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
      domainName: 'example.com',
      enableAutoConfigured: true, 
    };
    ({ app, stack } = initializeStackWithContextsAndEnvs(app, stack, context));

    expect(stack).toHaveResourceLike('Custom::AWSCDK-EKS-HelmChart', {
      "Values": "{\"statefulset\":{\"enabled\":true},\"nexus\":{\"imageTag\":\"3.23.0\",\"resources\":{\"requests\":{\"cpu\":\"256m\",\"memory\":\"4800Mi\"}},\"livenessProbe\":{\"path\":\"/\"},\"nodeSelector\":{\"usage\":\"nexus3\"}},\"nexusProxy\":{\"enabled\":true,\"port\":8081,\"env\":{\"nexusHttpHost\":\"example.com\"}},\"persistence\":{\"enabled\":true,\"storageClass\":\"efs-sc\",\"accessMode\":\"ReadWriteMany\"},\"nexusBackup\":{\"enabled\":false,\"persistence\":{\"enabled\":false}},\"ingress\":{\"enabled\":true,\"path\":\"/*\",\"annotations\":{\"alb.ingress.kubernetes.io/backend-protocol\":\"HTTP\",\"alb.ingress.kubernetes.io/healthcheck-path\":\"/\",\"alb.ingress.kubernetes.io/healthcheck-port\":8081,\"alb.ingress.kubernetes.io/listen-ports\":\"[{\\\"HTTP\\\": 80}]\",\"alb.ingress.kubernetes.io/scheme\":\"internet-facing\",\"alb.ingress.kubernetes.io/inbound-cidrs\":\"0.0.0.0/0\",\"alb.ingress.kubernetes.io/auth-type\":\"none\",\"alb.ingress.kubernetes.io/target-type\":\"ip\",\"kubernetes.io/ingress.class\":\"alb\",\"alb.ingress.kubernetes.io/tags\":\"app=nexus3\",\"alb.ingress.kubernetes.io/subnets\":\"s-12345,s-67890\"},\"tls\":{\"enabled\":false}},\"serviceAccount\":{\"create\":false},\"config\":{\"enabled\":true,\"data\":{\"nexus.properties\":\"nexus.scripts.allowCreation=true\"}},\"deployment\":{\"additionalVolumeMounts\":[{\"mountPath\":\"/nexus-data/etc/nexus.properties\",\"subPath\":\"nexus.properties\",\"name\":\"sonatype-nexus-conf\"}]}}",
    });
  
    expect(stack).toHaveResource('Custom::Nexus3AutoConfigure', {
      "Properties": {
        "ServiceToken": {
          "Fn::GetAtt": [
            "Neuxs3AutoCofingureE91D0A63",
            "Arn"
          ]
        },
        "Username": "admin",
        "Password": "admin123",
        "Endpoint": "https://example.com",
        "S3BucketName": {
          "Ref": "nexus3blobstore00DDADD3"
        }
      },
      "DependsOn": [
        "MyK8SClusterchartNexus321315D47"
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
    env: env ?? {
      region: 'cn-north-1',
      account: '1234567890xx',
    },
  });
  return { app, stack };
}