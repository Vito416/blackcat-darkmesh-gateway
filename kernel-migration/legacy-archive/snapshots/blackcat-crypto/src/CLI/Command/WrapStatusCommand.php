<?php
declare(strict_types=1);

namespace BlackCat\Crypto\CLI\Command;

use BlackCat\Crypto\Support\Envelope;

final class WrapStatusCommand implements CommandInterface
{
    public function name(): string { return 'wrap:status'; }
    public function description(): string { return 'Inspect envelope metadata (context, wrap count, KMS client).'; }

    /** @param list<string> $args */
    public function run(array $args): int
    {
        $file = $args[0] ?? null;
        if (!$file || !is_file($file)) {
            fwrite(STDERR, "Usage: wrap:status <envelope-file>\n");
            return 1;
        }
        $contents = file_get_contents($file);
        if ($contents === false) {
            fwrite(STDERR, "Unable to read {$file}\n");
            return 1;
        }
        try {
            $envelope = Envelope::decode($contents);
        } catch (\Throwable $e) {
            fwrite(STDERR, "Invalid envelope: {$e->getMessage()}\n");
            return 1;
        }
        $info = [
            'context' => $envelope->context,
            'kms' => $envelope->kmsMetadata,
            'meta' => $envelope->meta,
        ];
        echo json_encode($info, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
        return 0;
    }
}
