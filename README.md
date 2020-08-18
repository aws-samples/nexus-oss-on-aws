# Sonatype Nexus OSS on Amazon EKS

Deploy Sonatype Nexus3 via Helm on EKS.

- Use EFS via EFS CSI driver, PV and PVC as Nexus3 data storage
- Create a dedicated S3 bucket as Nexus3 blobstore
- Use external DNS to create record in Route53 for ingress domain name 
- Use ACM to get certificate of domain name

## Usage

### Prerequisites
- An AWS account
- Nodejs LTS installed, such as 12.x or 14.x
- A public hosted zone in Route53(optional)
- Has default VPC with public and private subnets cross two available zones at least, NAT gateway also is required
- Install dependencies of app  
```
npm run init
```

### Deploy to EKS with managed EC2 nodes
```
npm run deploy -- -c domainName=<the hostname of nexus3 deployment>
```

### Deploy with Route53 managed domain name
```
npm run deploy -- -c domainName=<nexus.mydomain.com> -c r53Domain=<mydomain.com>
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

Also this application uses below open source projects,

- [Nexus OSS](https://github.com/sonatype/nexus-public)
- [travelaudience/kubernetes-nexus](https://github.com/travelaudience/kubernetes-nexus/) - [Oteemo/charts](https://github.com/Oteemo/charts)
- [aws-alb-ingress-controller](https://github.com/kubernetes-sigs/aws-alb-ingress-controller)
- [aws-efs-csi-driver](https://github.com/kubernetes-sigs/aws-efs-csi-driver)
- [external-dns](https://github.com/kubernetes-sigs/external-dns)
