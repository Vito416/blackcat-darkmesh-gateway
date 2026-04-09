<?php
declare(strict_types=1);

namespace BlackCat\Auth\Support;

final class CompositeAuthHook implements AuthEventHookInterface
{
    /** @var list<AuthEventHookInterface> */
    private array $hooks;

    public function __construct(AuthEventHookInterface ...$hooks)
    {
        $this->hooks = array_values(array_filter($hooks));
    }

    public function onSuccess(string $event, array $context = []): void
    {
        foreach ($this->hooks as $hook) {
            $hook->onSuccess($event, $context);
        }
    }

    public function onFailure(string $event, array $context = []): void
    {
        foreach ($this->hooks as $hook) {
            $hook->onFailure($event, $context);
        }
    }
}
