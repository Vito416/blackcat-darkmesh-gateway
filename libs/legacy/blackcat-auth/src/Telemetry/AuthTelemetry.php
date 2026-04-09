<?php
declare(strict_types=1);

namespace BlackCat\Auth\Telemetry;

final class AuthTelemetry
{
    /** @var array<string,int> */
    private array $counters = [];

    public function __construct(private readonly ?string $prometheusFile)
    {
    }

    public function record(string $event, string $result): void
    {
        $this->increment('blackcat_auth_events_total');
        $this->increment('blackcat_auth_events_' . $event . '_total');
        $this->increment('blackcat_auth_events_' . $event . '_' . $result . '_total');
    }

    private function increment(string $metric, int $value = 1): void
    {
        $this->counters[$metric] = ($this->counters[$metric] ?? 0) + $value;
        $this->flush();
    }

    private function flush(): void
    {
        if ($this->prometheusFile === null) {
            return;
        }
        $dir = dirname($this->prometheusFile);
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }
        $lines = [];
        foreach ($this->counters as $name => $value) {
            $lines[] = sprintf('%s %d', $name, $value);
        }
        file_put_contents($this->prometheusFile, implode("\n", $lines));
    }
}
