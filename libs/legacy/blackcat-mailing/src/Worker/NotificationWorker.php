<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Worker;

use BlackCat\Core\Database;
use BlackCat\Database\Crypto\IngressLocator;
use BlackCat\Database\Packages\Notifications\Repository\NotificationRepository;
use BlackCat\Mailing\Config\MailingConfig;
use BlackCat\Mailing\Templates\PhpTemplateRenderer;
use BlackCat\Mailing\Templates\TemplateRendererInterface;
use BlackCat\Mailing\Transport\OutgoingEmail;
use BlackCat\Mailing\Transport\SmtpTransport;
use BlackCat\Mailing\Transport\TransportInterface;

final class NotificationWorker
{
    private readonly TransportInterface $transport;
    private readonly TemplateRendererInterface $templates;

    public function __construct(
        private readonly Database $db,
        private readonly NotificationRepository $notifications,
        private readonly MailingConfig $config,
        ?TransportInterface $transport = null,
        ?TemplateRendererInterface $templates = null,
    ) {
        $this->transport = $transport ?? new SmtpTransport(
            $config->smtpHost(),
            $config->smtpPort(),
            $config->smtpUser(),
            $config->smtpPass(),
            $config->smtpEncryption(),
        );
        $this->templates = $templates ?? PhpTemplateRenderer::default($config->templatesDir());
    }

    /**
     * @return array{processed:int,sent:int,failed:int,skipped:int}
     */
    public function runOnce(): array
    {
        $limit = $this->config->batchSize();
        $ids = $this->db->fetchAll(
            "SELECT id FROM vw_notifications_due WHERE channel = 'email' ORDER BY priority DESC, created_at ASC LIMIT :lim",
            ['lim' => $limit]
        );

        $processed = 0;
        $sent = 0;
        $failed = 0;
        $skipped = 0;

        foreach ($ids as $row) {
            $id = (int)($row['id'] ?? 0);
            if ($id <= 0) {
                continue;
            }
            $processed++;

            $locked = $this->claim($id);
            if ($locked === null) {
                $skipped++;
                continue;
            }

            try {
                $this->processRow($id, $locked);
                $sent++;
            } catch (\Throwable $e) {
                $failed++;
                $this->releaseWithFailure($locked, $e);
            }
        }

        return [
            'processed' => $processed,
            'sent' => $sent,
            'failed' => $failed,
            'skipped' => $skipped,
        ];
    }

    /**
     * @return array<string,mixed>|null Locked row snapshot.
     */
    private function claim(int $id): ?array
    {
        $worker = $this->config->workerName();
        $lockUntil = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify('+' . $this->config->lockSeconds() . ' seconds')
            ->format('Y-m-d H:i:s.u');

        return $this->db->transaction(function () use ($id, $worker, $lockUntil): ?array {
            $row = $this->notifications->lockById($id, 'skip_locked');
            if (!is_array($row)) {
                return null;
            }

            $status = (string)($row['status'] ?? '');
            if (!in_array($status, ['pending', 'processing'], true)) {
                return null;
            }

            if (!$this->isLockExpiredOrEmpty($row['locked_until'] ?? null)) {
                return null;
            }

            $updated = $this->notifications->updateById($id, [
                'status' => 'processing',
                'locked_by' => $worker,
                'locked_until' => $lockUntil,
                'last_attempt_at' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.u'),
                'retries' => (int)($row['retries'] ?? 0) + 1,
            ]);
            if ($updated <= 0) {
                return null;
            }

            $row['status'] = 'processing';
            $row['locked_by'] = $worker;
            $row['locked_until'] = $lockUntil;
            $row['retries'] = (int)($row['retries'] ?? 0) + 1;
            return $row;
        });
    }

    private function isLockExpiredOrEmpty(mixed $lockedUntil): bool
    {
        if ($lockedUntil === null || $lockedUntil === '') {
            return true;
        }
        if ($lockedUntil instanceof \DateTimeInterface) {
            return $lockedUntil <= new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        }
        if (!is_string($lockedUntil)) {
            return true;
        }

        try {
            $dt = new \DateTimeImmutable($lockedUntil, new \DateTimeZone('UTC'));
        } catch (\Throwable) {
            return true;
        }
        return $dt <= new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }

    /**
     * @param array<string,mixed> $row Locked row snapshot.
     */
    private function processRow(int $id, array $row): void
    {
        if (($row['channel'] ?? null) !== 'email') {
            throw new \RuntimeException('unsupported_channel');
        }

        $payload = $this->decodePayload($row['payload'] ?? null);
        $payload = $this->maybeDecryptPayload($payload);

        $to = (string)($payload['to_email'] ?? '');
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new \RuntimeException('invalid_recipient');
        }

        $template = (string)($row['template'] ?? '');
        $vars = is_array($payload['vars'] ?? null) ? (array)$payload['vars'] : [];
        $rendered = $this->templates->render($template !== '' ? $template : 'verify_email', $vars);

        $out = new OutgoingEmail(
            $this->config->fromEmail(),
            $this->config->fromName(),
            $to,
            isset($payload['to_name']) ? (string)$payload['to_name'] : null,
            $rendered->subject,
            $rendered->html,
            $rendered->text,
        );

        $this->transport->send($out);

        $this->notifications->updateById($id, [
            'status' => 'sent',
            'sent_at' => (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.u'),
            'locked_by' => null,
            'locked_until' => null,
            'error' => null,
            'next_attempt_at' => null,
        ]);
    }

    /**
     * @param array<string,mixed> $row
     */
    private function releaseWithFailure(array $row, \Throwable $e): void
    {
        $id = (int)($row['id'] ?? 0);
        if ($id <= 0) {
            return;
        }

        $retries = (int)($row['retries'] ?? 0);
        $max = (int)($row['max_retries'] ?? 0);
        $message = substr($e->getMessage() ?: get_class($e), 0, 5000);

        if ($max > 0 && $retries >= $max) {
            $this->notifications->updateById($id, [
                'status' => 'failed',
                'error' => $message,
                'locked_by' => null,
                'locked_until' => null,
                'next_attempt_at' => null,
            ]);
            return;
        }

        $delay = min(3600, max(30, (int)pow(2, max(0, $retries)) * 10));
        $next = (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))
            ->modify('+' . $delay . ' seconds')
            ->format('Y-m-d H:i:s.u');

        $this->notifications->updateById($id, [
            'status' => 'pending',
            'error' => $message,
            'locked_by' => null,
            'locked_until' => null,
            'next_attempt_at' => $next,
        ]);
    }

    /**
     * @return array<string,mixed>
     */
    private function decodePayload(mixed $raw): array
    {
        if (is_array($raw)) {
            return $raw;
        }
        if (!is_string($raw) || trim($raw) === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string,mixed> $payload
     * @return array<string,mixed>
     */
    private function maybeDecryptPayload(array $payload): array
    {
        try {
            $adapter = IngressLocator::adapter();
        } catch (\Throwable) {
            return $payload;
        }
        if (!is_object($adapter) || !method_exists($adapter, 'decrypt')) {
            return $payload;
        }

        try {
            /** @var array<string,mixed> $row */
            $row = $adapter->decrypt('notifications', ['payload' => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)], ['strict' => false]);
            $decoded = $this->decodePayload($row['payload'] ?? null);
            return $decoded !== [] ? $decoded : $payload;
        } catch (\Throwable) {
            return $payload;
        }
    }
}
