<?php
declare(strict_types=1);

namespace BlackCat\Auth\MagicLink;

interface MagicLinkDeliveryInterface
{
    public function queueMagicLinkEmail(
        string $email,
        ?int $userId,
        string $token,
        string $link,
        int $ttlSeconds,
    ): void;
}
