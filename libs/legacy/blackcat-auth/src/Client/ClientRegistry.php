<?php
declare(strict_types=1);

namespace BlackCat\Auth\Client;

/**
 * @phpstan-type ClientRecord array{
 *   secret: string,
 *   roles: list<string>,
 *   scopes: list<string>,
 *   access_ttl: int|null,
 *   pkce: bool
 * }
 */
final class ClientRegistry
{
    /**
     * @param array<string,ClientRecord> $clients
     */
    public function __construct(private readonly array $clients)
    {
    }

    /**
     * @param array<string,array<string,mixed>> $clients
     */
    public static function fromArray(array $clients): self
    {
        $normalized = [];
        foreach ($clients as $id => $data) {
            if (!is_array($data)) {
                continue;
            }
            $normalized[$id] = [
                'secret' => (string)($data['secret'] ?? ''),
                'roles' => array_values(array_filter((array)($data['roles'] ?? []), 'is_string')),
                'scopes' => array_values(array_filter((array)($data['scopes'] ?? []), 'is_string')),
                'access_ttl' => isset($data['access_ttl']) ? (int)$data['access_ttl'] : null,
                'pkce' => (bool)($data['pkce'] ?? true),
            ];
        }
        return new self($normalized);
    }

    /** @return ClientRecord|null */
    public function find(string $clientId): ?array
    {
        return $this->clients[$clientId] ?? null;
    }

    /** @return ClientRecord|null */
    public function verify(string $clientId, string $secret): ?array
    {
        $client = $this->find($clientId);
        if ($client === null) {
            return null;
        }
        if ($client['secret'] !== '' && !hash_equals($client['secret'], $secret)) {
            return null;
        }
        return $client;
    }

    public function allowsPkce(string $clientId): bool
    {
        $client = $this->find($clientId);
        return $client ? (bool)$client['pkce'] : false;
    }
}
