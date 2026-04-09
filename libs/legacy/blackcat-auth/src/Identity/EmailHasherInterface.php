<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

interface EmailHasherInterface
{
    public function normalize(string $email): string;

    /** @return list<EmailHashCandidate> */
    public function candidates(string $normalizedEmail): array;

    public function latest(string $normalizedEmail): ?EmailHashCandidate;
}
