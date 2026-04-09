<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime\Templates;

/**
 * Opinionated runtime-config template for Edgen Chain (chain_id=4207).
 *
 * This is intended for installers and other tooling that want a sane baseline
 * without duplicating JSON templates across repos.
 */
final class TrustKernelEdgenTemplate
{
    public const CHAIN_ID = 4207;
    public const RELEASE_REGISTRY = '0x22681Ee2153B7B25bA6772B44c160BB60f4C333E';
    public const INSTANCE_FACTORY = '0x92C80Cff5d75dcD3846EFb5DF35957D5Aed1c7C5';

    /**
     * @return list<string>
     */
    public static function rpcEndpoints(): array
    {
        return [
            'https://rpc.layeredge.io',
            'https://edgenscan.io/api/eth-rpc',
        ];
    }

    /**
 * @param 'root_uri'|'full' $mode
 * @return array{
 *   crypto:array{keys_dir:string,agent:array{socket_path:string}},
 *   db:array{agent:array{socket_path:string},credentials_file:string},
 *   trust:array{
 *     integrity:array{root_dir:string,manifest:string,image_digest_file:string},
 *     web3:array{
 *       chain_id:int,
 *       rpc_endpoints:list<string>,
 *       rpc_quorum:int,
 *       max_stale_sec:int,
     *       timeout_sec:int,
     *       mode:'root_uri'|'full',
     *       tx_outbox_dir:string,
     *       contracts:array{instance_controller:string,release_registry:string,instance_factory:string}
     *     }
     *   }
     * }
     */
    public static function build(string $mode = 'full'): array
    {
        if (!in_array($mode, ['root_uri', 'full'], true)) {
            throw new \InvalidArgumentException('Invalid mode (expected root_uri|full).');
        }

        return [
            'crypto' => [
                'keys_dir' => '/etc/blackcat/keys',
                'agent' => [
                    'socket_path' => '/etc/blackcat/secrets-agent.sock',
                ],
            ],
            'db' => [
                'agent' => [
                    'socket_path' => '/etc/blackcat/secrets-agent.sock',
                ],
                'credentials_file' => '/etc/blackcat/db.credentials.json',
            ],
            'trust' => [
                'integrity' => [
                    'root_dir' => '/srv/blackcat',
                    'manifest' => '/etc/blackcat/integrity.manifest.json',
                    'image_digest_file' => '/etc/blackcat/image.digest',
                ],
                'web3' => [
                    'chain_id' => self::CHAIN_ID,
                    'rpc_endpoints' => self::rpcEndpoints(),
                    'rpc_quorum' => 2,
                    'max_stale_sec' => 180,
                    'timeout_sec' => 5,
                    'mode' => $mode,
                    'tx_outbox_dir' => '/var/lib/blackcat/tx-outbox',
                    'contracts' => [
                        'instance_controller' => '0xYOUR_INSTALL_INSTANCE_CONTROLLER_CLONE',
                        'release_registry' => self::RELEASE_REGISTRY,
                        'instance_factory' => self::INSTANCE_FACTORY,
                    ],
                ],
            ],
        ];
    }
}
