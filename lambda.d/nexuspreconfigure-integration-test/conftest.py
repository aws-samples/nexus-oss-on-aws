import sys
import os
sys.path.append(os.path.dirname(os.path.realpath(__file__)) + "/../nexuspreconfigure")

import pytest
import os
from subprocess import Popen, PIPE
import nexuscli
import nexuscli.nexus_config
import nexuscli.nexus_client
import nexus

USERNAME = 'admin'
ENDPOINT = 'http://localhost:8081/'

@pytest.fixture(scope="session", autouse=True)
def nexus_password():
    if os.environ.get('NEXUS_PASS') is not None:
        return os.environ['NEXUS_PASS']
    process = Popen(["docker", "exec", "nexus", "cat", "/nexus-data/admin.password"], stdout=PIPE)
    (output, err) = process.communicate()
    exit_code = process.wait()
    assert exit_code == 0
    return output

@pytest.fixture(scope='session')
def nexus_helper(nexus_password):
    nexusHelper = nexus.Nexus(username=USERNAME, 
        password=nexus_password, endpoint=ENDPOINT)
    return nexusHelper

@pytest.fixture(scope='session')
def nexus_client(nexus_password):
    nexus_config = nexuscli.nexus_config.NexusConfig(
            username=USERNAME, password=nexus_password, url=ENDPOINT)
    nexus_client = nexuscli.nexus_client.NexusClient(config=nexus_config)
    return nexus_client