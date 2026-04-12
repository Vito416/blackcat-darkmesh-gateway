<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use Psr\Log\LoggerInterface;

final class KeyGenerateCommand implements CommandInterface
{
    public function __construct(private readonly LoggerInterface $logger) {}

    public function name(): string { return 'key:generate'; }
    public function description(): string { return '[DEPRECATED] Alias for key:rotate (use key:rotate).'; }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $slot = $args[0] ?? null;
        $output = $args[1] ?? null;
        if (!$slot || !$output) {
            fwrite(STDERR, "Usage: key:generate <slot> <output-file>\n");
            fwrite(STDERR, "Deprecated: use key:rotate <slot> <dir> [--manifest=...] [--format=...] [--length=...]\n");
            return 1;
        }

        // Keep legacy behavior (only key file, no meta) but use the modern key:rotate
        // implementation so manifest length + vN naming are respected.
        fwrite(STDERR, "DEPRECATED: key:generate is an alias for key:rotate. Use key:rotate instead.\n");
        $rotateArgs = array_merge([$slot, $output, '--no-meta'], array_slice($args, 2));
        return (new KeyRotateCommand($this->logger))->run($rotateArgs);
    }
}
