<?php

declare(strict_types=1);

namespace BlackCat\Config\Telemetry;

final class ConfigMetrics
{
    /**
     * @var array<string,int>
     */
    private array $counters = [];

    public function increment(string $metric, int $value = 1): void
    {
        $this->counters[$metric] = ($this->counters[$metric] ?? 0) + $value;
    }

    /**
     * @return array<string,int>
     */
    public function export(): array
    {
        return $this->counters;
    }
}
