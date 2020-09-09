import groovy.json.*
import org.sonatype.nexus.blobstore.api.*
import java.util.stream.*

blobStoreManager = blobStore.blobStoreManager

log.debug("Getting blobstores")
blobstores = new ArrayList<BlobStore>();
blobStoreManager.browse().forEach{
    blobstores.add(it)
}
new JsonBuilder(blobstores.stream().map{
    it.getBlobStoreConfiguration().getName()
}.collect(Collectors.toList())).toPrettyString()
