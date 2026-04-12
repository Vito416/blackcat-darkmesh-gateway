<?php

declare(strict_types=1);

namespace BlackCat\Config\Runtime\Templates;

/**
 * Portable runtime-config template for Edgen Chain (chain_id=4207).
 *
 * Unlike {@see TrustKernelEdgenTemplate}, this template uses **relative paths**
 * (resolved relative to the runtime-config file location).
 *
 * Recommended usage:
 * - place `config.runtime.json` in your **integrity root directory** (outside web docroot)
 * - keep `trust.integrity.root_dir="."` so it resolves to the integrity root
 * - place `integrity.manifest.json` next to the config file
 *
 * This is especially useful for:
 * - shared hosting / FTP installs (no root access, no /etc/blackcat)
 * - environments where absolute paths are inconvenient to pre-fill
 */
final class TrustKernelEdgenPortableTemplate
{
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
                // Relative to config dir (recommended: keep keys in a boundary outside the web runtime).
                'keys_dir' => 'keys',
                // Use a boundary socket by default (prevents raw key exfiltration).
                'agent' => [
                    'socket_path' => '.blackcat/secrets-agent.sock',
                ],
            ],
            'db' => [
                // Optional boundary (recommended). If present, inline db.dsn/user/pass must NOT be used.
                'agent' => [
                    'socket_path' => '.blackcat/secrets-agent.sock',
                ],
                'credentials_file' => '.blackcat/db.credentials.json',
            ],
            'trust' => [
                'integrity' => [
                    // Portable: treat the config directory as the integrity root.
                    // Place your runtime config next to your deployed code root for this to be meaningful.
                    'root_dir' => '.',
                    'manifest' => 'integrity.manifest.json',
                    // Optional (used only by strict policies that enforce image digest provenance).
                    'image_digest_file' => 'image.digest',
                ],
                'web3' => [
                    'chain_id' => TrustKernelEdgenTemplate::CHAIN_ID,
                    'rpc_endpoints' => TrustKernelEdgenTemplate::rpcEndpoints(),
                    'rpc_quorum' => 2,
                    'max_stale_sec' => 180,
                    'timeout_sec' => 5,
                    'mode' => $mode,
                    // Relative to config dir (buffer incidents / check-ins / upgrade intents).
                    'tx_outbox_dir' => '.blackcat/tx-outbox',
                    'contracts' => [
                        'instance_controller' => '0xYOUR_INSTALL_INSTANCE_CONTROLLER_CLONE',
                        'release_registry' => TrustKernelEdgenTemplate::RELEASE_REGISTRY,
                        'instance_factory' => TrustKernelEdgenTemplate::INSTANCE_FACTORY,
                    ],
                ],
            ],
        ];
    }
}

