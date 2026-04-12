<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Config;

final class MailingConfig
{
    public function __construct(
        private readonly string $smtpHost,
        private readonly int $smtpPort,
        private readonly ?string $smtpUser,
        private readonly ?string $smtpPass,
        private readonly string $smtpEncryption,
        private readonly string $fromEmail,
        private readonly string $fromName,
        private readonly string $workerName,
        private readonly int $lockSeconds,
        private readonly int $batchSize,
        private readonly ?string $templatesDir = null,
    ) {}

    public static function fromEnv(array $env = []): self
    {
        $env = $env ?: $_ENV + $_SERVER;

        $smtpHost = trim((string)($env['BLACKCAT_MAILING_SMTP_HOST'] ?? ''));
        $smtpPort = (int)($env['BLACKCAT_MAILING_SMTP_PORT'] ?? 587);
        $smtpUser = isset($env['BLACKCAT_MAILING_SMTP_USER']) ? (string)$env['BLACKCAT_MAILING_SMTP_USER'] : null;
        $smtpPass = isset($env['BLACKCAT_MAILING_SMTP_PASS']) ? (string)$env['BLACKCAT_MAILING_SMTP_PASS'] : null;
        $smtpEncryption = strtolower(trim((string)($env['BLACKCAT_MAILING_SMTP_ENCRYPTION'] ?? 'tls')));
        $fromEmail = trim((string)($env['BLACKCAT_MAILING_FROM_EMAIL'] ?? ''));
        $fromName = trim((string)($env['BLACKCAT_MAILING_FROM_NAME'] ?? 'BlackCat'));
        $workerName = trim((string)($env['BLACKCAT_MAILING_WORKER_NAME'] ?? 'blackcat-mailing-worker'));
        $lockSeconds = max(30, (int)($env['BLACKCAT_MAILING_LOCK_SECONDS'] ?? 300));
        $batchSize = max(1, (int)($env['BLACKCAT_MAILING_BATCH_SIZE'] ?? 50));
        $templatesDir = isset($env['BLACKCAT_MAILING_TEMPLATES_DIR']) ? trim((string)$env['BLACKCAT_MAILING_TEMPLATES_DIR']) : null;

        return new self(
            $smtpHost,
            $smtpPort > 0 ? $smtpPort : 587,
            $smtpUser !== '' ? $smtpUser : null,
            $smtpPass !== '' ? $smtpPass : null,
            in_array($smtpEncryption, ['tls', 'ssl', ''], true) ? $smtpEncryption : 'tls',
            $fromEmail,
            $fromName !== '' ? $fromName : 'BlackCat',
            $workerName !== '' ? $workerName : 'blackcat-mailing-worker',
            $lockSeconds,
            $batchSize,
            $templatesDir !== '' ? $templatesDir : null,
        );
    }

    public function smtpHost(): string { return $this->smtpHost; }
    public function smtpPort(): int { return $this->smtpPort; }
    public function smtpUser(): ?string { return $this->smtpUser; }
    public function smtpPass(): ?string { return $this->smtpPass; }
    public function smtpEncryption(): string { return $this->smtpEncryption; }
    public function fromEmail(): string { return $this->fromEmail; }
    public function fromName(): string { return $this->fromName; }
    public function workerName(): string { return $this->workerName; }
    public function lockSeconds(): int { return $this->lockSeconds; }
    public function batchSize(): int { return $this->batchSize; }
    public function templatesDir(): ?string { return $this->templatesDir; }
}

