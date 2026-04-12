<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

final class WebhookEventHook implements AuthEventHookInterface
{
    /** @var list<string> */
    private array $endpoints;

    /** @var callable */
    private $sender;

    /**
     * @param list<string> $endpoints
     * @param callable|null $sender function(string $url, array $payload): void
     */
    public function __construct(array $endpoints, ?callable $sender = null)
    {
        $this->endpoints = array_values(array_filter(array_map(static fn($url) => trim((string)$url), $endpoints)));
        $this->sender = $sender ?? [$this, 'defaultSender'];
    }

    public function onSuccess(string $event, array $context = []): void
    {
        $this->dispatch($event, $context + ['result' => 'success']);
    }

    public function onFailure(string $event, array $context = []): void
    {
        $this->dispatch($event, $context + ['result' => 'failure']);
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function dispatch(string $event, array $payload): void
    {
        if ($this->endpoints === []) {
            return;
        }
        $body = [
            'event' => $event,
            'payload' => $payload,
            'timestamp' => time(),
        ];
        foreach ($this->endpoints as $endpoint) {
            try {
                ($this->sender)($endpoint, $body);
            } catch (\Throwable) {
                // swallow errors to avoid breaking auth flows
            }
        }
    }

    /**
     * @param array<string,mixed> $body
     */
    private function defaultSender(string $url, array $body): void
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\n",
                'content' => json_encode($body, JSON_UNESCAPED_SLASHES),
                'timeout' => 1.5,
            ],
        ]);
        @file_get_contents($url, false, $context);
    }
}
