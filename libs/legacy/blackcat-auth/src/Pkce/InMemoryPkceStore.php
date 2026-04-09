<?php
declare(strict_types=1);

namespace BlackCat\Auth\Pkce;

final class InMemoryPkceStore implements PkceStoreInterface
{
    /** @var array<string,PkceSession> */
    private array $sessions = [];

    public function save(PkceSession $session): void
    {
        $this->sessions[$session->code] = $session;
    }

    public function consume(string $code): ?PkceSession
    {
        $session = $this->sessions[$code] ?? null;
        if ($session === null) {
            return null;
        }
        unset($this->sessions[$code]);
        if ($session->isExpired()) {
            return null;
        }
        return $session;
    }

    public function count(): int
    {
        $this->sessions = array_filter(
            $this->sessions,
            static fn (PkceSession $session) => !$session->isExpired()
        );
        return count($this->sessions);
    }
}
