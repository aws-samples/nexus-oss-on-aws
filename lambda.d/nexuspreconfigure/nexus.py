import nexuscli
import nexuscli.nexus_config
import nexuscli.nexus_client
import logging
import pathlib
import json

# logging.basicConfig(level=logging.INFO)
logger = logging.getLogger()
logger.setLevel(logging.INFO)

class Nexus:
    def __init__(self, username, password, endpoint):
        nexus_config = nexuscli.nexus_config.NexusConfig(
            username=username, password=password, url=endpoint)
        self.nexus_client = nexuscli.nexus_client.NexusClient(config=nexus_config)

    def deleteAllRepos(self):
        self.nexus_client.repositories.refresh()
        repositories = self.nexus_client.repositories.raw_list()
        for repo in repositories:
            logger.info(f"""| Nexus: deleting repo with name '{repo['name']}', 
                format '{repo['format']}' and type '{repo['type']}""")
            self.nexus_client.repositories.delete(repo['name'])

    def removeDefaultFileBlobstore(self):
        logger.info(f"| Nexus: deleting default file blobstore")
        scriptName = "deleteDefaultBlobstore"
        self._createScript(self.nexus_client, scriptName)
        self.nexus_client.scripts.run(scriptName)

    def _createScript(self, client, scriptName):
        if client.scripts.exists(scriptName):
            logger.warn(f"| Nexus: deleting existing script {scriptName} for recreating a new one")
            client.scripts.delete(scriptName)
        with open(f"{pathlib.Path(__file__).parent.absolute()}/{scriptName}.groovy") as f:
            scriptContent = f.read()
            logger.info(f"| Nexus: creating script {scriptName}")
            client.scripts.create(scriptName, scriptContent)

    def createS3Blobstore(self, blobName, s3Bucket, expiration):
        logger.info(f"""| Nexus: creating s3 file blobstore with name {blobName}, 
            bucket {s3Bucket} and expiration {expiration}""")
        scriptName = "createBlobstore"
        self._createScript(self.nexus_client, scriptName)
        resp = self.nexus_client.scripts.run(scriptName, json.dumps({
            'name': blobName,
            'type': 's3',
            'config': {
                'expiration': expiration,
                'bucket': s3Bucket,
            }
        }))

        if resp['result'] == "already exists":
            logger.warn(f"| Nexus: creating existing bucket '{blobName}'!")
        logger.info(f"| Nexus: created bucket '{blobName}' with response {resp['result']}")