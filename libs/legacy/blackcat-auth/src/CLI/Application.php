<?php
declare(strict_types=1);

namespace BlackCat\Auth\CLI;

use BlackCat\Auth\CLI\Command\CommandInterface;
use BlackCat\Auth\CLI\Command\ConfigShowCommand;
use BlackCat\Auth\CLI\Command\RbacCheckCommand;
use BlackCat\Auth\CLI\Command\RbacListCommand;
use BlackCat\Auth\CLI\Command\SecurityCheckCommand;
use BlackCat\Auth\CLI\Command\TokenClientCommand;
use BlackCat\Auth\CLI\Command\TokenIssueCommand;
use BlackCat\Auth\CLI\Command\UserHashPasswordCommand;
use BlackCat\Auth\CLI\Command\UsersListCommand;
use BlackCat\Auth\CLI\Command\UsersSeedCommand;
use BlackCat\Auth\Foundation\AuthRuntime;

final class Application
{
    /** @var array<string,CommandInterface> */
    private array $commands = [];

    public function __construct(private readonly AuthRuntime $runtime)
    {
        $this->register(new TokenIssueCommand());
        $this->register(new RbacListCommand());
        $this->register(new RbacCheckCommand());
        $this->register(new TokenClientCommand());
        $this->register(new UserHashPasswordCommand());
        $this->register(new UsersSeedCommand());
        $this->register(new UsersListCommand());
        $this->register(new SecurityCheckCommand());
        $this->register(new ConfigShowCommand());
    }

    public function register(CommandInterface $command): void
    {
        $this->commands[$command->name()] = $command;
    }

    /**
     * @param list<string> $args
     */
    public function run(string $command, array $args): int
    {
        if ($command === 'help' || !isset($this->commands[$command])) {
            $this->printHelp();
            return $command === 'help' ? 0 : 1;
        }

        return $this->commands[$command]->run($args, $this->runtime);
    }

    private function printHelp(): void
    {
        echo "Usage: auth <config.php> <command> [args]\n\n";
        echo "Available commands:\n";
        foreach ($this->commands as $command) {
            echo sprintf("  %s - %s\n", $command->name(), $command->description());
        }
    }
}
