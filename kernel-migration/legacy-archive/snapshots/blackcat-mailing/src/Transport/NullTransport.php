<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Transport;

final class NullTransport implements TransportInterface
{
    public function send(OutgoingEmail $email): void
    {
    }
}

