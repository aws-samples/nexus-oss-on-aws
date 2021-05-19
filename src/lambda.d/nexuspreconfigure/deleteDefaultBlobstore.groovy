
blobStoreManager = blobStore.blobStoreManager

void deleteDefaultBlobStores() {
    List<String> stores = blobStoreManager.browse()*.blobStoreConfiguration*.name
    stores.findAll {
        it == "default"
    }.each {
        blobStoreManager.delete(it)
    }
}

deleteDefaultBlobStores()
'success'