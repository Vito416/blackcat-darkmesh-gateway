<?php
declare(strict_types=1);

namespace BlackCat\Auth\PasswordReset;

final class PasswordResetException extends \RuntimeException
{
    public function __construct(
        public readonly string $reason,
        string $message = '',
        int $code = 0,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message !== '' ? $message : $reason, $code, $previous);
    }
}

