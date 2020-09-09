import json
import logging
import urllib3
from uuid import uuid4
import nexus

logger = logging.getLogger()
logger.setLevel(logging.INFO)
http = urllib3.PoolManager()

CFN_SUCCESS = "SUCCESS"
CFN_FAILED = "FAILED"

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
        if request_type != "Delete":
            username = props['Username']
            password  = props['Password']
            endpoint = props['Endpoint']
            blobstoreName = props['BlobStoreName'] if 'BlobStoreName' in props else 's3-blobsstore'
            bucketName = props['S3BucketName']
            nexusHelper = nexus.Nexus(username=username, password=password, endpoint=endpoint)
            nexusHelper.deleteAllRepos()
            nexusHelper.removeDefaultFileBlobstore()
            nexusHelper.createS3Blobstore(blobstoreName, bucketName, '-1')
            cfn_send(event, context, CFN_SUCCESS, physicalResourceId=physical_id)
    except KeyError as e:
        cfn_error(f"invalid request. Missing key {str(e)}")
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