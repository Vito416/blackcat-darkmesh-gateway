<?php
declare(strict_types=1);

namespace BlackCat\Auth\Password;

final class PasswordVerificationResult
{
    public function __construct(
        private readonly bool $valid,
        private readonly ?string $version
    ) {}

    public function isValid(): bool
    {
        return $this->valid;
    }

    public function matchedVersion(): ?string
    {
        return $this->version;
    }
}
