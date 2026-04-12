<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Rotation;

use BlackCat\Crypto\Support\Envelope;

final class RotationPolicyRegistry
{
    /** @var array<string,RotationPolicy> */
    private array $policies = [];

    /** @param array<string,array<string,mixed>> $config */
    public static function fromArray(array $config): ?self
    {
        if ($config === []) {
            return null;
        }
        $self = new self();
        foreach ($config as $context => $definition) {
            $self->policies[$context] = RotationPolicy::fromArray($definition);
        }
        return $self;
    }

    public function shouldRotate(Envelope $envelope): bool
    {
        foreach ($this->policies as $pattern => $policy) {
            if ($this->matches($envelope->context, $pattern) && $policy->shouldRotate($envelope)) {
                return true;
            }
        }
        return false;
    }

    private function matches(string $context, string $pattern): bool
    {
        $regex = str_replace(['.', '*'], ['\.', '.*'], $pattern);
        return (bool)preg_match('~^' . $regex . '$~i', $context);
    }
}
