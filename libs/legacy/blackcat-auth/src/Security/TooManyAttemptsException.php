<?php
declare(strict_types=1);

namespace BlackCat\Auth\Security;

final class TooManyAttemptsException extends \RuntimeException
{
    public function __construct(public readonly int $retryAfterSeconds = 0)
    {
        parent::__construct('too_many_attempts');
    }
}

