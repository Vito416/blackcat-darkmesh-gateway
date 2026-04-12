<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Templates;

final class PhpTemplateRenderer implements TemplateRendererInterface
{
    /**
     * @param list<string> $templateDirs
     */
    public function __construct(private readonly array $templateDirs)
    {
    }

    public static function default(?string $extraDir = null): self
    {
        $dirs = [];
        if (is_string($extraDir) && trim($extraDir) !== '') {
            $dirs[] = rtrim($extraDir, DIRECTORY_SEPARATOR);
        }
        $dirs[] = rtrim(__DIR__ . '/../../templates/email', DIRECTORY_SEPARATOR);
        return new self($dirs);
    }

    public function render(string $template, array $vars): RenderedEmail
    {
        $name = trim($template);
        if ($name === '' || !preg_match('~^[a-zA-Z0-9_\\-/]+$~', $name)) {
            throw new \InvalidArgumentException('Invalid template name');
        }

        $file = $this->resolve($name . '.php');
        if ($file === null) {
            throw new \RuntimeException('Template not found: ' . $name);
        }

        $data = $vars;
        $out = (static function (string $file, array $data): mixed {
            return require $file;
        })($file, $data);

        if (!is_array($out)) {
            throw new \RuntimeException('Template must return array{subject,html,text}');
        }
        $subject = (string)($out['subject'] ?? '');
        $html = (string)($out['html'] ?? '');
        $text = (string)($out['text'] ?? '');
        if ($subject === '' || ($html === '' && $text === '')) {
            throw new \RuntimeException('Template returned empty subject/body');
        }
        if ($text === '') {
            $text = trim(strip_tags($html));
        }
        if ($html === '') {
            $html = nl2br(htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        }
        return new RenderedEmail($subject, $html, $text);
    }

    private function resolve(string $relative): ?string
    {
        foreach ($this->templateDirs as $dir) {
            $dir = rtrim((string)$dir, DIRECTORY_SEPARATOR);
            if ($dir === '') {
                continue;
            }
            $candidate = $dir . DIRECTORY_SEPARATOR . ltrim($relative, DIRECTORY_SEPARATOR);
            if (!is_file($candidate)) {
                continue;
            }
            $real = realpath($candidate);
            if (!is_string($real) || $real === '') {
                continue;
            }
            $dirReal = realpath($dir);
            if (!is_string($dirReal) || $dirReal === '') {
                continue;
            }
            if (!str_starts_with($real, $dirReal . DIRECTORY_SEPARATOR) && $real !== $dirReal) {
                continue;
            }
            return $real;
        }
        return null;
    }
}

