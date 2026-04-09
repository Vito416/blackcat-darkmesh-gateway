<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

final class EmailHashCandidate
{
    public function __construct(
        public readonly string $value,
        public readonly ?string $version
    ) {}
}
