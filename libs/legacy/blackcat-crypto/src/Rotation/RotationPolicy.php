<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Rotation;

use BlackCat\Crypto\Support\Envelope;

final class RotationPolicy
{
    public function __construct(
        private readonly ?int $maxAgeSeconds = null,
        private readonly ?int $maxWraps = null,
    ) {}

    /** @param array<string,mixed> $data */
    public static function fromArray(array $data): self
    {
        return new self(
            isset($data['maxAgeSeconds']) ? (int)$data['maxAgeSeconds'] : null,
            isset($data['maxWraps']) ? (int)$data['maxWraps'] : null,
        );
    }

    public function shouldRotate(Envelope $envelope): bool
    {
        if ($this->maxAgeSeconds !== null) {
            $created = (int)($envelope->meta['createdAt'] ?? 0);
            if ($created && (time() - $created) >= $this->maxAgeSeconds) {
                return true;
            }
        }
        if ($this->maxWraps !== null) {
            $wrapCount = (int)($envelope->meta['wrapCount'] ?? 0);
            if ($wrapCount >= $this->maxWraps) {
                return true;
            }
        }
        return false;
    }
}
