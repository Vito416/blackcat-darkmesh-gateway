<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

final class LoggingAuthHook implements AuthEventHookInterface
{
    public function __construct(private readonly LoggerInterface $logger = new NullLogger())
    {
    }

    public function onSuccess(string $event, array $context = []): void
    {
        $this->logger->info('auth.event.' . $event, $context + ['result' => 'success']);
    }

    public function onFailure(string $event, array $context = []): void
    {
        $this->logger->warning('auth.event.' . $event, $context + ['result' => 'failure']);
    }
}
