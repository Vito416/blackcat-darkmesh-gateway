<?php

declare(strict_types=1);

namespace BlackCat\Config\Integration;

use BlackCat\Config\Profile\ConfigProfile;

final class IntegrationChecker
{
    /**
     * @return array<int,string> Missing binaries or issues.
     */
    public function check(ConfigProfile $profile): array
    {
        $issues = [];
        foreach ($profile->integrations() as $name => $path) {
            if ($path === '') {
                $issues[] = "Integration {$name} is empty.";
                continue;
            }

            if ($this->isExternalReference($path)) {
                continue;
            }

            if (!is_file($path) && !is_executable($path)) {
                $issues[] = "Integration {$name} not found at {$path}";
            }
        }

        return $issues;
    }

    private function isExternalReference(string $path): bool
    {
        return preg_match('#^[A-Za-z]+://#', $path) === 1;
    }
}
