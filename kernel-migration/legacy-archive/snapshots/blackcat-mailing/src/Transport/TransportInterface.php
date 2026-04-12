<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Transport;

interface TransportInterface
{
    public function send(OutgoingEmail $email): void;
}

