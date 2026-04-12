<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

final class StreamingAuthHook implements AuthEventHookInterface
{
    private readonly \Closure $publisher;

    /**
     * @param callable $publisher function(string $event, array $payload): void
     */
    public function __construct(callable $publisher)
    {
        $this->publisher = \Closure::fromCallable($publisher);
    }

    public function onSuccess(string $event, array $context = []): void
    {
        ($this->publisher)($event, $context + ['result' => 'success']);
    }

    public function onFailure(string $event, array $context = []): void
    {
        ($this->publisher)($event, $context + ['result' => 'failure']);
    }
}
