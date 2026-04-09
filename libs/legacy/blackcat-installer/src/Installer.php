<?php
declare(strict_types=1);

namespace BlackCat\Installer;

use BlackCat\Installer\Bootstrap\BootstrapRunner;
use BlackCat\Installer\Env\EnvRenderer;
use BlackCat\Installer\Modules\ModuleCatalog;
use Psr\Log\LoggerInterface;
use Psr\Log\NullLogger;

final class Installer
{
    private ModuleCatalog $catalog;

    public function __construct(
        ?ModuleCatalog $catalog = null,
        private readonly LoggerInterface $logger = new NullLogger(),
        private readonly ?EnvRenderer $envRenderer = null,
        private readonly ?BootstrapRunner $bootstrapRunner = null
    ) {
        $this->catalog = $catalog ?? new ModuleCatalog(__DIR__ . '/../modules.json');
    }

    /**
     * @param list<string> $modules
     */
    public function install(array $modules, ?string $envOut = null, bool $runBootstrap = true, array $extraEnv = []): void
    {
        $resolved = $this->catalog->filter($modules);
        $this->logger->info('installer.install', ['modules' => $resolved]);

        foreach ($resolved as $module) {
            $this->logger->info('installer.module', $module->toArray());
            // composer/npm commands would be invoked here
            $this->logger->info('installer.module.composer', ['packages' => $module->composerPackages()]);
            $this->logger->info('installer.module.bootstrap', ['commands' => $module->bootstrapCommands()]);
            $this->logger->info('installer.module.docker', ['commands' => $module->dockerCommands()]);
        }

        if ($envOut !== null) {
            $renderer = $this->envRenderer ?? new EnvRenderer();
            $renderer->write($envOut, $resolved, $extraEnv);
            $this->logger->info('installer.env.generated', ['path' => $envOut]);
        }

        if ($runBootstrap) {
            $runner = $this->bootstrapRunner ?? new BootstrapRunner($this->logger);
            $runner->run($resolved);
        }
    }

    public function available(): array
    {
        return array_map(static fn ($module) => $module->toArray(), $this->catalog->all());
    }
}
