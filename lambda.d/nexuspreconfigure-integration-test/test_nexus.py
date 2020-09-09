import pytest
import nexuscli
import nexuscli.nexus_config
import nexuscli.nexus_client
import nexus
import pathlib
import json

@pytest.mark.integration
def test_nexus_init(nexus_helper):
    """Ensure that the instantiation of Nexus"""
    assert nexus_helper is not None
    
@pytest.mark.integration
def test_nexus_cleanrepos(nexus_helper, nexus_client):
    assert len(nexus_client.repositories.raw_list()) > 0
    nexus_helper.deleteAllRepos()
    assert len(nexus_client.repositories.raw_list()) == 0

@pytest.mark.integration
def test_remove_default_blobstore(nexus_helper, nexus_client):
    scriptName = 'getBlobstores'
    _createScript(nexus_client, scriptName)
    blobs = json.loads(nexus_client.scripts.run(scriptName)['result'])
    assert len(blobs) == 1
    nexus_helper.removeDefaultFileBlobstore()
    blobs = json.loads(nexus_client.scripts.run(scriptName)['result'])
    assert len(blobs) == 0

def _createScript(client, scriptName):
    if client.scripts.exists(scriptName):
        client.scripts.delete(scriptName)
    with open(f"{pathlib.Path(__file__).parent.absolute()}/{scriptName}.groovy") as f:
        scriptContent = f.read()
        client.scripts.create(scriptName, scriptContent)