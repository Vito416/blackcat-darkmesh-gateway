<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Transport;

final class OutgoingEmail
{
    public function __construct(
        public readonly string $fromEmail,
        public readonly string $fromName,
        public readonly string $toEmail,
        public readonly ?string $toName,
        public readonly string $subject,
        public readonly string $htmlBody,
        public readonly string $textBody,
    ) {}
}

