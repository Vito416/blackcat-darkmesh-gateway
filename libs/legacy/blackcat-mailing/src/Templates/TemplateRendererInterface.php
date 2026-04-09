<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Templates;

interface TemplateRendererInterface
{
    /**
     * @param array<string,mixed> $vars
     */
    public function render(string $template, array $vars): RenderedEmail;
}

