<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

final class EventBuffer
{
    /** @var list<array<string,mixed>> */
    private array $events = [];
    private int $nextId = 1;

    public function __construct(private readonly int $limit = 200)
    {
    }

    /**
     * @param array<string,mixed> $payload
     */
    public function push(string $event, array $payload): void
    {
        $this->events[] = [
            'id' => $this->nextId++,
            'event' => $event,
            'payload' => $payload,
            'timestamp' => time(),
        ];
        if (count($this->events) > $this->limit) {
            $this->events = array_slice($this->events, -$this->limit);
        }
    }

    /**
     * @return list<array<string,mixed>>
     */
    public function history(?int $afterId = null): array
    {
        if ($afterId === null) {
            return $this->events;
        }
        return array_values(array_filter(
            $this->events,
            static fn(array $event) => $event['id'] > $afterId
        ));
    }

    public function lastId(): int
    {
        return $this->nextId - 1;
    }
}
