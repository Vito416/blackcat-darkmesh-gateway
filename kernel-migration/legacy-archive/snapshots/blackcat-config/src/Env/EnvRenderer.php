<?php

declare(strict_types=1);

namespace BlackCat\Config\Env;

use BlackCat\Config\Profile\ConfigProfile;
use RuntimeException;

final class EnvRenderer
{
    public function render(ConfigProfile $profile, string $targetPath): string
    {
        $template = $profile->envTemplatePath();
        $buffer = '';
        if ($template !== null && is_file($template)) {
            $buffer .= rtrim((string) file_get_contents($template)) . PHP_EOL . PHP_EOL;
        } else {
            $buffer .= "# Generated env template for profile {$profile->name()}" . PHP_EOL;
        }

        $buffer .= "# === Rendered values ===" . PHP_EOL;
        foreach ($profile->env() as $key => $value) {
            $buffer .= sprintf("%s=%s%s", $key, $value, PHP_EOL);
        }

        $dir = dirname($targetPath);
        if (!is_dir($dir) && !mkdir($dir, 0775, true) && !is_dir($dir)) {
            throw new RuntimeException("Failed to create directory {$dir}");
        }

        if (file_put_contents($targetPath, $buffer) === false) {
            throw new RuntimeException("Failed to write env file to {$targetPath}");
        }

        return $targetPath;
    }
}
