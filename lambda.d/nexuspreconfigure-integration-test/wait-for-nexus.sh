#!/usr/bin/env bash

function nexus_ready {
  [[ "200" == $(curl -o /dev/null -s -w "%{http_code}\n" "$1") ]]
}

count=0
until nexus_ready "${1:-http://localhost:8081}"
do
  count=$((count+1))
  if [ ${count} -gt 100 ]
  then
    echo 'Timeout-out waiting for nexus container'
    docker logs --tail 50 nexus
    docker ps
    curl -sv "%{http_code}\n" "$1"
    netstat -ntlp
    exit 1
  fi
  sleep 5
done
