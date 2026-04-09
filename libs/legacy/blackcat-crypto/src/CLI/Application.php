<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI;

use BlackCat\Crypto\CLI\Command\CommandInterface;
use BlackCat\Crypto\CLI\Command\KeyGenerateCommand;
use BlackCat\Crypto\CLI\Command\WrapStatusCommand;
use BlackCat\Crypto\CLI\Command\KmsDiagCommand;
use BlackCat\Crypto\CLI\Command\WrapQueueCommand;
use BlackCat\Crypto\CLI\Command\MetricsExportCommand;
use BlackCat\Crypto\CLI\Command\TelemetrySseCommand;
use BlackCat\Crypto\CLI\Command\KmsWatchdogCommand;
use BlackCat\Crypto\CLI\Command\ManifestShowCommand;
use BlackCat\Crypto\CLI\Command\ManifestDiffCommand;
use BlackCat\Crypto\CLI\Command\VaultMigrateCommand;
use BlackCat\Crypto\CLI\Command\VaultDiagCommand;
use BlackCat\Crypto\CLI\Command\VaultDecryptCommand;
use BlackCat\Crypto\CLI\Command\VaultReportCommand;
use BlackCat\Crypto\CLI\Command\VaultCoverageCommand;
use BlackCat\Crypto\CLI\Command\KeyRotateCommand;
use BlackCat\Crypto\CLI\Command\ManifestValidateCommand;
use BlackCat\Crypto\CLI\Command\KeysLintCommand;
use BlackCat\Crypto\CLI\Command\KmsSuspendCommand;
use BlackCat\Crypto\CLI\Command\KmsResumeCommand;
use BlackCat\Crypto\CLI\Command\KmsListCommand;
use BlackCat\Crypto\CLI\Command\TelemetryIntentsCommand;
use BlackCat\Crypto\CLI\Command\GovernanceAssessCommand;
use BlackCat\Crypto\CLI\Command\DbSnapshotCommand;
use Psr\Log\NullLogger;

final class Application
{
    /** @var array<string,CommandInterface> */
    private array $commands = [];

    public function __construct()
    {
        $logger = new NullLogger();
        $this->register(new KeyGenerateCommand($logger));
        $this->register(new WrapStatusCommand());
        $this->register(new KmsDiagCommand($logger));
        $this->register(new WrapQueueCommand($logger));
        $this->register(new MetricsExportCommand($logger));
        $this->register(new TelemetrySseCommand($logger));
        $this->register(new KmsWatchdogCommand($logger));
        $this->register(new ManifestShowCommand());
        $this->register(new ManifestDiffCommand());
        $this->register(new ManifestValidateCommand());
        $this->register(new KeysLintCommand());
        $this->register(new KeyRotateCommand($logger));
        $this->register(new KmsSuspendCommand($logger));
        $this->register(new KmsResumeCommand($logger));
        $this->register(new KmsListCommand($logger));
        $this->register(new VaultMigrateCommand());
        $this->register(new VaultDiagCommand());
        $this->register(new VaultDecryptCommand());
        $this->register(new VaultReportCommand());
        $this->register(new VaultCoverageCommand());
        $this->register(new TelemetryIntentsCommand());
        $this->register(new GovernanceAssessCommand());
        $this->register(new DbSnapshotCommand());
    }

    public function register(CommandInterface $command): void
    {
        $this->commands[$command->name()] = $command;
    }

    /** @param list<string> $argv */
    public function run(array $argv): int
    {
        $command = $argv[1] ?? 'help';
        if ($command === 'help' || !isset($this->commands[$command])) {
            $this->printHelp();
            return $command === 'help' ? 0 : 1;
        }
        return $this->commands[$command]->run(array_slice($argv, 2));
    }

    private function printHelp(): void
    {
        echo "Available commands:\n";
        foreach ($this->commands as $command) {
            echo sprintf("  %s - %s\n", $command->name(), $command->description());
        }
    }
}
