<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

use BlackCat\Auth\Telemetry\AuthTelemetry;

final class TelemetryAuthHook implements AuthEventHookInterface
{
    public function __construct(private readonly AuthTelemetry $telemetry)
    {
    }

    public function onSuccess(string $event, array $context = []): void
    {
        $this->telemetry->record($event, 'success');
    }

    public function onFailure(string $event, array $context = []): void
    {
        $this->telemetry->record($event, 'failure');
    }
}
