import groovy.json.JsonSlurper
import org.sonatype.nexus.repository.config.Configuration
import groovy.transform.ToString

@ToString
class Blobstore {
    String name
    String type
    Map<String,String> config
}

blobStoreManager = blobStore.blobStoreManager

if (args != "") {
    log.info("Creating blobstore with args [${args}]")
    def blobstore = convertJsonFileToBlobstore(args)
    log.info("Got blobstore [${blobstore}]")
    validateBlobstore(blobstore)
    createBlobstore(blobstore)
}

def validateBlobstore(Blobstore blobstore) {
    if (blobstore.name == null)
        throw new IllegalArgumentException("The name of blobstore is required.")
    if (blobstore.type == null)
        throw new IllegalArgumentException("The type of blobstore is required.")
    if (blobstore.type == "s3" && (blobstore.config == null || !blobstore.config.containsKey('bucket')))
        throw new IllegalArgumentException("The bucket config of s3 blobstore is required.")
}

def createBlobstore(Blobstore blobstore) {
    if(!blobStoreManager.get(blobstore.name)) {
        if (blobstore.type == 's3')
            blobStore.createS3BlobStore(blobstore.name, blobstore.config)
        else
            new UnsupportedOperationException(blobstore.type + " is not supported")
    } else {
        return "already exists"
    }
    "success"
}

def convertJsonFileToBlobstore(String jsonData) {
    def inputJson = new JsonSlurper().parseText(jsonData)
    log.debug("Creating blobstore object for [${inputJson}]")
    Blobstore blobstore = new Blobstore()
    inputJson.each {
        if (it.key == 'name')
            blobstore.name = it.value
        else if (it.key == 'type')
            blobstore.type = it.value
        else if (it.key == 'config')
            blobstore.config = it.value
    }

    log.debug("Created blobstore object [${blobstore}]")
    blobstore
}
