<?php
declare(strict_types=1);

namespace BlackCat\Auth\Identity;

final class PlainEmailHasher implements EmailHasherInterface
{
    public function normalize(string $email): string
    {
        $normalized = trim($email);
        if (class_exists(\Normalizer::class, true)) {
            $normalized = \Normalizer::normalize($normalized, \Normalizer::FORM_C) ?: $normalized;
        }
        return mb_strtolower($normalized, 'UTF-8');
    }

    public function candidates(string $normalizedEmail): array
    {
        return [new EmailHashCandidate($normalizedEmail, null)];
    }

    public function latest(string $normalizedEmail): ?EmailHashCandidate
    {
        return new EmailHashCandidate($normalizedEmail, null);
    }
}
