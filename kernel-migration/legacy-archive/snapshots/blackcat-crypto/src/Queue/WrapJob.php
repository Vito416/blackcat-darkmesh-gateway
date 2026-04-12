<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Queue;

final class WrapJob
{
    public readonly string $id;
    public readonly int $enqueuedAt;
    public int $attempts;
    public ?string $lastError;
    public ?int $lastErrorAt;

    public function __construct(
        public readonly string $context,
        public readonly string $payload,
        int $attempts = 0,
        ?string $lastError = null,
        ?int $lastErrorAt = null,
        ?int $enqueuedAt = null,
        ?string $id = null,
    ) {
        $this->attempts = $attempts;
        $this->lastError = $lastError;
        $this->lastErrorAt = $lastErrorAt;
        $this->enqueuedAt = $enqueuedAt ?? time();
        $this->id = $id ?? bin2hex(random_bytes(8));
    }

    /** @param array<string,mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self(
            context: (string)($data['context'] ?? ''),
            payload: (string)($data['payload'] ?? ''),
            attempts: (int)($data['attempts'] ?? 0),
            lastError: isset($data['lastError']) ? (string)$data['lastError'] : null,
            lastErrorAt: isset($data['lastErrorAt']) ? (int)$data['lastErrorAt'] : null,
            enqueuedAt: isset($data['enqueuedAt']) ? (int)$data['enqueuedAt'] : null,
            id: isset($data['id']) ? (string)$data['id'] : null,
        );
    }

    /** @return array{context:string,payload:string,attempts:int,enqueuedAt:int,id:string,lastError:?string,lastErrorAt:?int} */
    public function toArray(): array
    {
        return [
            'context' => $this->context,
            'payload' => $this->payload,
            'attempts' => $this->attempts,
            'enqueuedAt' => $this->enqueuedAt,
            'id' => $this->id,
            'lastError' => $this->lastError,
            'lastErrorAt' => $this->lastErrorAt,
        ];
    }

    public function requeue(): self
    {
        return new self(
            context: $this->context,
            payload: $this->payload,
            attempts: $this->attempts,
            lastError: $this->lastError,
            lastErrorAt: $this->lastErrorAt,
            enqueuedAt: time(),
            id: $this->id,
        );
    }
}
