#!/bin/bash
set -e

ARWEAVE_NODE="${ARWEAVE_NODE:-http://localhost:1984}"
HB_PORT="${HB_PORT:-8001}"
DATA_DIR="${DATA_DIR:-/data/rolling}"
AUTO_INDEX="${AUTO_INDEX:-true}"
REMOTE_GATEWAY="${REMOTE_GATEWAY:-https://arweave.net}"
ARWEAVE_INDEX_BLOCKS="${ARWEAVE_INDEX_BLOCKS:-true}"
LOAD_REMOTE_DEVICES="${LOAD_REMOTE_DEVICES:-true}"
HB_NUM_ACCEPTORS="${HB_NUM_ACCEPTORS:-64}"
HB_MAX_CONNECTIONS="${HB_MAX_CONNECTIONS:-4096}"
HB_ARWEAVE_INDEX_WORKERS="${HB_ARWEAVE_INDEX_WORKERS:-24}"
HB_LMDB_MAX_READERS="${HB_LMDB_MAX_READERS:-1024}"
HB_LMDB_CAPACITY="${HB_LMDB_CAPACITY:-137438953472}"
RESULT_ROUTE_GATEWAY="${RESULT_ROUTE_GATEWAY:-${REMOTE_GATEWAY}}"
DRY_RUN_ROUTE_GATEWAY="${DRY_RUN_ROUTE_GATEWAY:-${REMOTE_GATEWAY}}"

# Keep persistent store paths explicit to avoid partial-store behavior.
mkdir -p "${DATA_DIR}" "${DATA_DIR}/lmdb" "${DATA_DIR}/fs-mainnet"

cat > /app/config.json <<EOF
{
  "ao-types": "generate_index=atom,max_connections=integer,num_acceptors=integer",
  "port": ${HB_PORT},
  "num_acceptors": ${HB_NUM_ACCEPTORS},
  "max_connections": ${HB_MAX_CONNECTIONS},
  "arweave_index_workers": ${HB_ARWEAVE_INDEX_WORKERS},
  "arweave_index_blocks": ${ARWEAVE_INDEX_BLOCKS},
  "load_remote_devices": ${LOAD_REMOTE_DEVICES},
  "gateway": "${REMOTE_GATEWAY}",
  "routes": [
    {
      "template": "^/arweave(?:/.*)?$",
      "node": {
        "prefix": "${ARWEAVE_NODE}"
      }
    },
    {
      "template": "^/graphql(?:\\\\?.*)?$",
      "node": {
        "prefix": "${REMOTE_GATEWAY}"
      }
    },
    {
      "template": "^/[A-Za-z0-9_-]{43}(?:\\\\?.*)?$",
      "node": {
        "prefix": "${REMOTE_GATEWAY}"
      }
    },
    {
      "template": "^/tx/[A-Za-z0-9_-]{43}(?:\\\\?.*)?$",
      "node": {
        "prefix": "${REMOTE_GATEWAY}"
      }
    },
    {
      "template": "^/result/[0-9]+(?:\\\\?.*)?$",
      "node": {
        "prefix": "${RESULT_ROUTE_GATEWAY}"
      }
    },
    {
      "template": "^/dry-run(?:\\\\?.*)?$",
      "node": {
        "prefix": "${DRY_RUN_ROUTE_GATEWAY}"
      }
    }
  ],
  "store": [
    {
      "ao-types": "store-module=atom",
      "store-module": "hb_store_lmdb",
      "name": "${DATA_DIR}/lmdb",
      "access": ["read", "write"],
      "max-readers": ${HB_LMDB_MAX_READERS},
      "capacity": ${HB_LMDB_CAPACITY}
    },
    {
      "ao-types": "store-module=atom",
      "store-module": "hb_store_fs",
      "name": "${DATA_DIR}/fs-mainnet",
      "access": ["read", "write"]
    },
    {
      "ao-types": "store-module=atom,scope=atom",
      "store-module": "hb_store_arweave",
      "name": "cache-arweave",
      "access": ["read"],
      "scope": "remote",
      "arweave-node": "${REMOTE_GATEWAY}",
      "index-store": [
        {
          "ao-types": "store-module=atom",
          "store-module": "hb_store_lmdb",
          "name": "${DATA_DIR}/lmdb",
          "access": ["read", "write"],
          "max-readers": ${HB_LMDB_MAX_READERS},
          "capacity": ${HB_LMDB_CAPACITY}
        }
      ]
    },
    {
      "ao-types": "store-module=atom",
      "store-module": "hb_store_gateway",
      "subindex": [
        {
          "name": "Data-Protocol",
          "value": "ao"
        }
      ],
      "local-store": [
        {
          "ao-types": "store-module=atom",
          "store-module": "hb_store_lmdb",
          "name": "${DATA_DIR}/lmdb",
          "access": ["read", "write"],
          "max-readers": ${HB_LMDB_MAX_READERS},
          "capacity": ${HB_LMDB_CAPACITY}
        }
      ]
    },
    {
      "ao-types": "store-module=atom",
      "store-module": "hb_store_gateway",
      "local-store": [
        {
          "ao-types": "store-module=atom",
          "store-module": "hb_store_lmdb",
          "name": "${DATA_DIR}/lmdb",
          "access": ["read", "write"],
          "max-readers": ${HB_LMDB_MAX_READERS},
          "capacity": ${HB_LMDB_CAPACITY}
        }
      ]
    }
  ]
}
EOF

start_cron() {
    until curl -s -o /dev/null -w "%{http_code}" "http://localhost:${HB_PORT}/~meta@1.0/info" 2>/dev/null | grep -q 200; do
        sleep 2
    done
    curl -s "http://localhost:${HB_PORT}/~cron@1.0/every?interval=1-second&cron-path=~copycat@1.0/arweave&from=-1&to=-19" > /dev/null
    echo "Continuous indexing started."
}

if [ "$AUTO_INDEX" = "true" ]; then
    start_cron &
fi

export HB_CONFIG=/app/config.json
exec /app/hb/bin/hb foreground
