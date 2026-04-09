<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

interface MagicLinkStoreInterface
{
    public function save(MagicLinkToken $token): void;
    public function find(string $fingerprint): ?MagicLinkToken;
    public function delete(string $fingerprint): void;
}
