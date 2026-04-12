<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Watchdog;

use BlackCat\Crypto\Kms\KmsRouter;
use Psr\Log\LoggerInterface;

final class KmsWatchdog
{
    /** @var array<int,string> */
    private array $healthyStatuses;
    private int $suspendTtl;

    /**
     * @param array{healthy?:list<string>,suspend_ttl?:int}|array<string,mixed> $config
     */
    public function __construct(
        private readonly KmsRouter $router,
        private readonly ?LoggerInterface $logger = null,
        array $config = []
    ) {
        $this->healthyStatuses = array_map('strtolower', $config['healthy'] ?? ['ok', 'green']);
        $this->suspendTtl = (int)($config['suspend_ttl'] ?? 120);
    }

    /**
     * @param array<int,array<string,mixed>> $health
     */
    public function evaluate(array $health): void
    {
        foreach ($health as $entry) {
            $clientId = (string)($entry['client'] ?? '');
            if ($clientId === '') {
                continue;
            }
            $statusRaw = $entry['status'] ?? [];
            $status = is_array($statusRaw)
                ? strtolower((string)($statusRaw['status'] ?? 'unknown'))
                : strtolower((string)$statusRaw);

            if (in_array($status, $this->healthyStatuses, true)) {
                $this->router->release($clientId);
                continue;
            }

            $this->router->suspend($clientId, $this->suspendTtl);
            $this->logger?->warning('crypto.watchdog.suspend', [
                'client' => $clientId,
                'status' => $status,
                'ttl' => $this->suspendTtl,
            ]);
        }
    }
}
