<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI\Command;

use BlackCat\Auth\Foundation\AuthRuntime;

final class SecurityCheckCommand implements CommandInterface
{
    public function name(): string { return 'security:check'; }
    public function description(): string { return 'Run basic health/security checks for config, database, and telemetry.'; }

    /** @param list<string> $args */
    public function run(array $args, AuthRuntime $runtime): int
    {
        unset($args);
        $report = $runtime->healthReport();
        $signingOk = ($report['signing_key_length'] ?? 0) >= 32;
        $status = [
            'config' => $report['config'],
            'database' => $report['database'] ?? 'n/a',
            'telemetry' => $report['telemetry'],
            'user_store_driver' => $report['user_store_driver'],
            'signing_key' => $signingOk ? 'ok' : 'too short',
        ];
        echo json_encode($status, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return $signingOk ? 0 : 2;
    }
}
