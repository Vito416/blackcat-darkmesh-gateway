<?php

declare(strict_types=1);

namespace BlackCat\Config\Security;

use BlackCat\Config\Profile\ConfigProfile;

final class SecurityChecklist
{
    /**
     * @return array<int,string> Issues found in the profile.
     */
    public function validate(ConfigProfile $profile): array
    {
        $issues = [];
        $rules = $profile->securityRules();
        $env = $profile->env();

        foreach (($rules['required_env'] ?? []) as $key) {
            if (!array_key_exists($key, $env)) {
                $issues[] = "Missing required env variable: {$key}";
            }
        }

        if (($rules['requires_tls'] ?? false) === true) {
            $url = $env['APP_URL'] ?? '';
            if (!is_string($url) || $url === '' || strncmp($url, 'https://', 8) !== 0) {
                $issues[] = 'requires_tls enabled but APP_URL is not HTTPS.';
            }
        }

        foreach (($rules['secrets'] ?? []) as $key) {
            $value = $env[$key] ?? null;
            if ($value === null) {
                $issues[] = "Secret placeholder missing for {$key}";
                continue;
            }
            $value = (string) $value;
            if (!$this->isPlaceholder($value)) {
                $issues[] = "Secret {$key} should reference env/secret placeholder, got literal value.";
            }
        }

        if ($profile->envTemplatePath() === null) {
            $issues[] = 'Env template missing (env_template).';
        }

        if (($rules['min_modules'] ?? 0) > 0 && count($profile->modules()) < (int) $rules['min_modules']) {
            $issues[] = sprintf(
                'Profile %s must include at least %d modules, got %d.',
                $profile->name(),
                (int) $rules['min_modules'],
                count($profile->modules())
            );
        }

        return $issues;
    }

    private function isPlaceholder(string $value): bool
    {
        return strncmp($value, '${env:', 6) === 0 || strncmp($value, '${secret:', 9) === 0;
    }
}
