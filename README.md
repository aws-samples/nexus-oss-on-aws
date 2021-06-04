# Sonatype Nexus Repository OSS on Amazon EKS

Deploy Sonatype Nexus Repository OSS via Helm on EKS.

- Use EFS via EFS CSI driver, PV and PVC as Nexus3 data storage
- Create a dedicated S3 bucket as Nexus3 blobstore
- Use external DNS to create record in Route53 for ingress domain name 
- Use ACM to get certificate of domain name

## Architecture diagram
![architecture diagram](arch.png)

## Usage

### Prerequisites
- An AWS account
- Nodejs LTS installed, such as 12.x or 14.x
- Install Docker Engine
- A public hosted zone in Route53(optional)
- Has default VPC with public and private subnets cross two available zones at least, NAT gateway also is required
- Install dependencies of app  
```
yarn install --check-files --frozen-lockfile
npx projen
```

### Deployment
#### Deploy with custom domain
```
npx cdk deploy --parameters NexusAdminInitPassword=<init admin password of nexus3>  --parameters DomainName=<the hostname of nexus3 deployment>
```

#### Deploy with Route53 managed domain name
```
npx cdk deploy --parameters NexusAdminInitPassword=<init admin password of nexus3> --parameters DomainName=<nexus.mydomain.com> -c r53Domain=<mydomain.com>
```
or
```
npx cdk deploy --parameters NexusAdminInitPassword=<init admin password of nexus3> --parameters DomainName=<nexus.mydomain.com> --parameters R53HostedZoneId=<id of route53 hosted zone> -c enableR53HostedZone=true
```

#### Deploy to an existing VPC
This solution will create new VPC across two AZs with public, private subnets and NAT gateways by default.

You can deploy the solution to the existing VPC by below options,
```
npx cdk deploy <other options> -c vpcId=<existing vpc id>

# or deploy to the default vpc
npx cdk deploy <other options> -c vpcId=default
```

**NOTE**: the existing VPC must have public and private subnets across two AZs and route the internet traffic of private subnets to NAT gateways.

#### Deploy with internal load balancer
```
npx cdk deploy -c internalALB=true
```

#### Customize the version of Kubernetes
The solution will create [Kubernetes 1.20](https://docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html#kubernetes-1.20) by default. You can specify other Kubernetes versions like below,
```
npx cdk deploy <other options> --parameters KubernetesVersion=1.19
```

**NOTE**: `1.20`, `1.19` and `1.18` are allowed versions. You can NOT enable [auto configuration feat](#auto-configuration) when creating an EKS cluster with version **1.19**. See [this issue](https://github.com/aws/aws-cdk/issues/14933) for detail. 

#### Deploy to China regions
Due to AWS load balancer has different policy requirement for partitions, you need speicfy the target region info via context `region` to pick the corresponding IAM policies.
```
npx cdk deploy <other options> -c region=cn-north-1
```

#### Deploy to existing EKS cluster
The solution could deploy the Nexus Repository OSS to the existing EKS cluster. There are some prerequisites that your EKS cluster must meet,

- the version of EKS cluster is v1.17+,
- the EKS cluster has EC2 based node group which is required by EFS CSI driver,
- the ARN of an IAM role mapped to the `system:masters` RBAC role. If the cluster you are using was created using the AWS CDK, the CloudFormation stack has an output that includes an IAM role that can be used. Otherwise, you can create an IAM role and map it to `system:masters` manually. The trust policy of this role should include the the `arn:aws::iam::${accountId}:root` principal in order to allow the execution role of the kubectl resource to assume it. Then you can follow the [eksctl guide](https://eksctl.io/usage/iam-identity-mappings/) to map the IAM role to Kubernetes RBAC,
- the OpenId connect provider ARN of your EKS. You can find the ARN from IAM's console. If your cluster does not have an OpenId connect provider, you can follow the [eksctl guide](https://eksctl.io/usage/iamserviceaccounts/) to create one,
- the ARN of the IAM role associated with the nodegroup in your cluster. You can find the ARN of node group from EKS console.
 
Below is an example to deploy Nexus Repository OSS to an existing EKS cluster with public domain configured,
```bash
npx cdk deploy -c vpcId=vpc-12345 -c importedEKS=true -c eksClusterName=the-cluster-name -c eksKubectlRoleArn=arn:aws:iam::123456789012:role/eks-kubectl-role -c eksOpenIdConnectProviderArn=arn:aws:iam::123456789012:oidc-provider/oidc.eks.ap-east-1.amazonaws.com/id/12345678 -c nodeGroupRoleArn=arn:aws:iam::123456789012:role/eksctl-cluster-nodegroup-ng-NodeInstanceRole-123456 --parameters NexusAdminInitPassword=<the strong password> -c enableAutoConfigured=true --parameters DomainName=<the custom domain> --parameters R53HostedZoneId=<id of r53 zone> -c enableR53HostedZone=true
```

### Init admin password
You must specify the default init admin password when deploying this solution. The password must satisfy below requirements,
- at least 8 characters
- must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number
- can contain special characters

### Auto configuration
Nexus3 supports using [script][nexus3-script] to configure the Nexus3 service, for example, BlobStores, Repositories and so on. The script feature is disabled by default since Nexus3 3.21.2. You can opt-in auto configuration feature of this solution like below that will enable script feature of Nexus.
```
npx cdk deploy <other options> -c enableAutoConfigured=true
```
It would automatically configure the fresh provisioning Nexus3 with below changes,

- Delete all built-in repositories
- Delete default `file` based blobstore
- Create a new blobstore named `s3-blobstore` using the dedicated S3 bucket created by this solution with never expiration policy for artifacts

### How to clean
Run below command to clean the deployment or delete the `SonatypeNexus3OnEKS` stack via CloudFormation console.
```
npx cdk destroy
```
**NOTE**: you still need manually delete the EFS file system and S3 bucket created by this solution. Those storage might contain your data, be caution before deleting them.

## Quick deployment
It's [an official solution][nexus-oss-on-aws-solution] of AWS China regions. You can quickly deploy this solution to below regions via CloudFormation,

Region name | Region code | Launch
--- | --- | ---
Global regions(switch to the region you want to deploy) | us-east-1(default) | [![Launch Stack](LaunchStack.jpg)](https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/template?stackName=NexusOSS&templateURL=https://aws-gcr-solutions.s3.amazonaws.com/nexus-oss-on-aws/latest/nexus-repository-oss-on-aws.template.json)
AWS China(Beijing) Region | cn-north-1 | [![Launch Stack](LaunchStack.jpg)](https://console.amazonaws.cn/cloudformation/home?region=cn-north-1#/stacks/new?stackName=NexusOSS&templateURL=https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/nexus-oss-on-aws/latest/nexus-repository-oss-on-aws-cn.template.json)
AWS China(Ningxia) Region | cn-northwest-1 | [![Launch Stack](LaunchStack.jpg)](https://console.amazonaws.cn/cloudformation/home?region=cn-northwest-1#/stacks/new?stackName=NexusOSS&templateURL=https://aws-gcr-solutions.s3.cn-north-1.amazonaws.com.cn/nexus-oss-on-aws/latest/nexus-repository-oss-on-aws-cn.template.json)


## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

Also this application uses below open source projects,

- [Nexus OSS](https://github.com/sonatype/nexus-public)
- [travelaudience/kubernetes-nexus](https://github.com/travelaudience/kubernetes-nexus/) 
- Nexus3 Helm chart in [Oteemo/charts](https://github.com/Oteemo/charts)
- [AWS Load Balancer Controller](https://github.com/kubernetes-sigs/aws-load-balancer-controller)
- [EKS Charts](https://github.com/aws/eks-charts)
- [aws-efs-csi-driver](https://github.com/kubernetes-sigs/aws-efs-csi-driver)
- [external-dns](https://github.com/kubernetes-sigs/external-dns)
- [nexus3-cli](https://gitlab.com/thiagocsf/nexus3-cli)

[nexus3-script]: https://help.sonatype.com/repomanager3/rest-and-integration-api/script-api
[nexus-oss-on-aws-solution]: https://www.amazonaws.cn/solutions/nexusoss-on-aws/
