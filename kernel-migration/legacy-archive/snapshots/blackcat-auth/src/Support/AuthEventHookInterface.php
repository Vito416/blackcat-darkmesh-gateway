<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

interface AuthEventHookInterface
{
    /**
     * @param array<string,mixed> $context
     */
    public function onSuccess(string $event, array $context = []): void;

    /**
     * @param array<string,mixed> $context
     */
    public function onFailure(string $event, array $context = []): void;
}
