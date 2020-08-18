import * as cdk from '@aws-cdk/core';
import * as cxapi from '@aws-cdk/cx-api';
import * as mock from './context-provider-mock';
import '@aws-cdk/assert/jest';
import * as SonatypeNexus3 from '../lib/sonatype-nexus3-stack';

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
    ({ app, stack } = overrideStackWithContextDomainName(app, stack, 'example.com'));
  });

  test('Nexus Stack is created', () => {
    expect(stack).toHaveResourceLike('AWS::CloudFormation::Stack', {
    });
  });

});

function overrideStackWithContextDomainName(app: cdk.App, stack: cdk.Stack, 
  domainName: string | undefined, domainZone?: string) {
  app = new cdk.App({
    context: {
      domainName: domainName,
      domainZone,
    }
  });

  const env = {
    region: 'cn-north-1',
    account: '1234567890xx',
  }

  stack = new SonatypeNexus3.SonatypeNexus3Stack(app, 'NexusStack', {
    env,
  });
  return { app, stack };
}
