import json
import logging
import time
import urllib3
from uuid import uuid4
import os
import subprocess

logger = logging.getLogger()
logger.setLevel(logging.INFO)
http = urllib3.PoolManager()

CFN_SUCCESS = "SUCCESS"
CFN_FAILED = "FAILED"

# these are coming from the kubectl layer
os.environ['PATH'] = '/opt/kubectl:/opt/awscli:' + os.environ['PATH']

outdir = os.environ.get('TEST_OUTDIR', '/tmp') # nosec
kubeconfig = os.path.join(outdir, 'kubeconfig')

def handler(event, context):

    def cfn_error(message=None):
        logger.error("| cfn_error: %s" % message)
        cfn_send(event, context, CFN_FAILED, reason=message)

    try:
        logger.info(event)

        # cloudformation request type (create/update/delete)
        request_type = event['RequestType']
        
        # extract resource properties
        props = event['ResourceProperties']
        old_props = event.get('OldResourceProperties', {})

        if request_type == "Create":
            physical_id = f"nexus.on.aws.{str(uuid4())}"
        else:
            physical_id = event.get('PhysicalResourceId', None)
            if not physical_id:
                cfn_error("invalid request: request type is '%s' but 'PhysicalResourceId' is not defined" % request_type)
                return
        if request_type == "Delete":
            # resource properties (all required)
            cluster_name  = props['ClusterName']
            role_arn      = props['RoleArn']
            # "log in" to the cluster
            subprocess.check_call([ 'aws', 'eks', 'update-kubeconfig',
                '--role-arn', role_arn,
                '--name', cluster_name,
                '--kubeconfig', kubeconfig
            ])

            object_type         = props['ObjectType']
            object_name         = props['ObjectName']
            object_namespace    = props['ObjectNamespace']
            json_path           = props['JsonPath']
            timeout_seconds     = props['TimeoutSeconds']
            relase              = props['Release']

            output = wait_for_purge(['get', '-n', object_namespace, object_type, object_name, "-o=jsonpath='{{{0}}}'".format(json_path)], int(timeout_seconds))
            logger.info(f"The resource {object_type}/{object_name} has been purged.")

            try:
                kubectl(['delete', '-n', object_namespace, 'pvc', '-l', f'release={relase}'])
                logger.info(f'The PVC of helm relese {relase} is purged.')
            except Exception as e:
                error = str(e)
                if 'NotFound' in error or b'i/o timeout' in error:
                    logger.warn(f"Got error '{error}'', cluster/resource might have been purged.")
                else:
                    raise
        cfn_send(event, context, CFN_SUCCESS, physicalResourceId=physical_id)
    except KeyError as e:
        cfn_error(f"invalid request. Missing key {str(e)}")
    except subprocess.CalledProcessError as exc:
        errMsg = f'the cmd {exc.cmd} returns {exc.returncode} with stdout {exc.output} and stderr {exc.stderr}'
        logger.error(errMsg)
        cfn_error(errMsg)
    except Exception as e:
        logger.exception(e)
        cfn_error(str(e))

# sends a response to cloudformation
def cfn_send(event, context, responseStatus, responseData={}, physicalResourceId=None, noEcho=False, reason=None):

    responseUrl = event['ResponseURL']
    logger.info(responseUrl)

    responseBody = {}
    responseBody['Status'] = responseStatus
    responseBody['Reason'] = reason or ('See the details in CloudWatch Log Stream: ' + context.log_stream_name)
    responseBody['PhysicalResourceId'] = physicalResourceId or context.log_stream_name
    responseBody['StackId'] = event['StackId']
    responseBody['RequestId'] = event['RequestId']
    responseBody['LogicalResourceId'] = event['LogicalResourceId']
    responseBody['NoEcho'] = noEcho
    responseBody['Data'] = responseData

    body = json.dumps(responseBody)
    logger.info("| response body:\n" + body)

    headers = {
        'content-type' : '',
        'content-length' : str(len(body))
    }

    try:
        response = http.request('PUT',
                                responseUrl,
                                body=body,
                                headers=headers,
                                retries=False)
        logger.info("| status code: " + str(response.status))
    except Exception as e:
        logger.error("| unable to send response to CloudFormation")
        logger.exception(e)

def wait_for_purge(args, timeout_seconds):

  end_time = time.time() + timeout_seconds
  error = None

  while time.time() < end_time:
    try:
      # the output is surrounded with '', so we unquote
      output = kubectl(args).decode('utf-8')[1:-1]
      if output:
        pass
    except Exception as e:
      error = str(e)
      # also a recoverable error
      if 'NotFound' in error:
          return 'Resource is purged'
      elif b'i/o timeout' in error:
          logger.warn(f"Got connection error '{error}' when watching resource, ignore it")
          return 'Cluster might be purged'
      else:
          raise
    time.sleep(10)

  raise RuntimeError(f'Timeout waiting for output from kubectl command: {args} (last_error={error})')

def kubectl(args):
    retry = 3
    while retry > 0:
        try:
            cmd = [ 'kubectl', '--kubeconfig', kubeconfig ] + args
            output = subprocess.check_output(cmd, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError as exc:
            output = exc.output
            if b'i/o timeout' in output and retry > 0:
                logger.info("kubectl timed out, retries left: %s" % retry)
                retry = retry - 1
            else:
                raise Exception(output)
        else:
            logger.info(output)
            return output
