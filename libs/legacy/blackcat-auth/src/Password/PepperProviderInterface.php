<?php
declare(strict_types=1);

namespace BlackCat\Auth\Password;

interface PepperProviderInterface
{
    public function current(): Pepper;

    /** @return list<Pepper> */
    public function all(): array;

    public function byVersion(string $version): ?Pepper;
}
