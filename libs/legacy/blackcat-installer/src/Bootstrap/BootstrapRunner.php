<?php
declare(strict_types=1);

namespace BlackCat\Installer\Bootstrap;

use BlackCat\Installer\Modules\Module;
use Psr\Log\LoggerInterface;

final class BootstrapRunner
{
    public function __construct(private readonly ?LoggerInterface $logger = null) {}

    /**
     * @param Module[] $modules
     */
    public function run(array $modules): void
    {
        foreach ($modules as $module) {
            foreach ($module->bootstrapCommands() as $command) {
                $this->execute($command, $module->id);
            }
        }
    }

    private function execute(string $command, string $moduleId): void
    {
        $this->logger?->info('installer.bootstrap.start', ['module' => $moduleId, 'command' => $command]);

        $process = proc_open($command, [
            0 => ['pipe', 'r'],
            1 => STDOUT,
            2 => STDERR,
        ], $pipes, null, null);

        if (!is_resource($process)) {
            throw new \RuntimeException("Failed to start bootstrap command: {$command}");
        }

        $status = proc_close($process);
        if ($status !== 0) {
            throw new \RuntimeException("Bootstrap command failed ({$command}) exit {$status}");
        }

        $this->logger?->info('installer.bootstrap.done', ['module' => $moduleId, 'command' => $command]);
    }
}
