<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

final class NullAuthEventHook implements AuthEventHookInterface
{
    public function onSuccess(string $event, array $context = []): void
    {
    }

    public function onFailure(string $event, array $context = []): void
    {
    }
}
