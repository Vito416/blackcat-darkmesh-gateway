<?php
declare(strict_types=1);

namespace BlackCat\Auth\Pkce;

interface PkceStoreInterface
{
    public function save(PkceSession $session): void;
    public function consume(string $code): ?PkceSession;
    public function count(): int;
}
