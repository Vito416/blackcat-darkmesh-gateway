<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Telemetry;

final class SseStreamer
{
    /**
     * @param callable():array<string,mixed> $provider
     */
    public function stream(callable $provider, int $intervalSeconds = 5, ?int $iterations = null): void
    {
        $count = 0;
        while (true) {
            $snapshot = $provider();
            echo "event: snapshot\n";
            echo 'data: ' . json_encode($snapshot, JSON_UNESCAPED_SLASHES) . "\n\n";
            @ob_flush();
            @flush();
            $count++;
            if ($iterations !== null && $iterations > 0 && $count >= $iterations) {
                break;
            }
            sleep(max(1, $intervalSeconds));
        }
    }
}
