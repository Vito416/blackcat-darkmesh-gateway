<?php
declare(strict_types=1);

namespace BlackCat\Mailing\CoreCompat;

use BlackCat\Core\Database;
use BlackCat\Database\Packages\Notifications\Repository\NotificationRepository;
use BlackCat\Database\Packages\Tenants\Repository\TenantRepository;
use BlackCat\Mailing\Config\MailingConfig;
use BlackCat\Mailing\Queue\NotificationEnqueuer;
use BlackCat\Mailing\Queue\SlugTenantResolver;
use BlackCat\Mailing\Queue\TenantResolverInterface;
use BlackCat\Mailing\Worker\NotificationWorker;

/**
 * Backwards-compat facade for the legacy `BlackCat\Core\Mail\Mailer`.
 *
 * - init($config, $pdo) wires DB + SMTP config
 * - enqueue($payloadArr) writes into `notifications` outbox
 * - processPendingNotifications($limit) runs worker once
 */
final class CoreMailer
{
    private static ?Database $db = null;
    private static ?MailingConfig $config = null;
    private static ?TenantResolverInterface $tenants = null;
    private static ?NotificationEnqueuer $enqueuer = null;

    private function __construct() {}

    public static function init(array $config, \PDO $pdo): void
    {
        Database::initFromPdo($pdo);
        self::$db = Database::getInstance();
        self::$config = self::configFromLegacy($config);

        $tenantSlug = self::readString($config, ['tenant_slug', 'tenant', 'tenantSlug'], 'default') ?: 'default';
        $tenantName = self::readString($config, ['tenant_name', 'tenantName'], 'Default tenant') ?: 'Default tenant';
        $autoCreate = self::readBool($config, ['auto_create_tenant', 'autoCreateTenant'], true);

        $tenantRepo = new TenantRepository(self::$db);
        self::$tenants = new SlugTenantResolver($tenantRepo, $tenantSlug, $tenantName, $autoCreate);

        $notifications = new NotificationRepository(self::$db);
        self::$enqueuer = new NotificationEnqueuer(self::$db, $notifications, self::$tenants);
    }

    public static function enqueue(array $payloadArr, int $maxRetries = 0): int
    {
        $enq = self::enqueuer();
        $template = trim((string)($payloadArr['template'] ?? ''));
        if ($template === '') {
            $template = 'verify_email';
        }

        $userId = isset($payloadArr['user_id']) ? (int)$payloadArr['user_id'] : null;
        if ($userId !== null && $userId <= 0) {
            $userId = null;
        }

        $priority = isset($payloadArr['priority']) ? (int)$payloadArr['priority'] : 0;
        $priority = max(-100, min(100, $priority));

        $payload = self::mapLegacyPayload($payloadArr);
        $maxRetries = $maxRetries > 0 ? $maxRetries : 6;

        return $enq->enqueueEmail($template, $payload, $userId, $priority, $maxRetries);
    }

    /**
     * Run worker once.
     *
     * @return array{processed:int,sent:int,failed:int,skipped:int}
     */
    public static function processPendingNotifications(int $limit = 100): array
    {
        $db = self::db();
        $cfg = self::$config ?? MailingConfig::fromEnv();
        $cfg = self::withBatchSize($cfg, $limit);

        $notifications = new NotificationRepository($db);
        $worker = new NotificationWorker($db, $notifications, $cfg);
        return $worker->runOnce();
    }

    private static function enqueuer(): NotificationEnqueuer
    {
        if (self::$enqueuer instanceof NotificationEnqueuer) {
            return self::$enqueuer;
        }
        throw new \RuntimeException('CoreMailer not initialized: call BlackCat\\Core\\Mail\\Mailer::init($config, $pdo) first.');
    }

    private static function db(): Database
    {
        if (self::$db instanceof Database) {
            return self::$db;
        }
        throw new \RuntimeException('CoreMailer not initialized: call BlackCat\\Core\\Mail\\Mailer::init($config, $pdo) first.');
    }

    private static function configFromLegacy(array $config): MailingConfig
    {
        $smtp = is_array($config['smtp'] ?? null) ? (array)$config['smtp'] : [];

        $smtpHost = trim((string)($smtp['host'] ?? $config['smtp_host'] ?? getenv('BLACKCAT_MAILING_SMTP_HOST') ?: ''));
        $smtpPort = (int)($smtp['port'] ?? $config['smtp_port'] ?? getenv('BLACKCAT_MAILING_SMTP_PORT') ?: 587);
        $smtpUser = isset($smtp['user']) ? (string)$smtp['user'] : (isset($smtp['username']) ? (string)$smtp['username'] : null);
        $smtpPass = isset($smtp['pass']) ? (string)$smtp['pass'] : (isset($smtp['password']) ? (string)$smtp['password'] : null);
        $smtpEnc = strtolower(trim((string)($smtp['secure'] ?? $smtp['encryption'] ?? getenv('BLACKCAT_MAILING_SMTP_ENCRYPTION') ?: 'tls')));
        if (!in_array($smtpEnc, ['tls', 'ssl', ''], true)) {
            $smtpEnc = 'tls';
        }

        $fromEmail = '';
        $fromName = 'BlackCat';

        $from = $smtp['from'] ?? ($config['smtp_from'] ?? null);
        if (is_array($from)) {
            $fromEmail = trim((string)($from['email'] ?? $from['from_email'] ?? $from['address'] ?? ''));
            $fromName = trim((string)($from['name'] ?? $from['from_name'] ?? '')) ?: $fromName;
        } elseif (is_string($from)) {
            $fromEmail = trim($from);
        }

        if ($fromEmail === '') {
            $fromEmail = trim((string)($smtp['from_email'] ?? getenv('BLACKCAT_MAILING_FROM_EMAIL') ?: ''));
        }
        if ($fromName === 'BlackCat') {
            $fromName = trim((string)($smtp['from_name'] ?? getenv('BLACKCAT_MAILING_FROM_NAME') ?: 'BlackCat')) ?: 'BlackCat';
        }

        $workerName = self::readString($config, ['worker_name', 'workerName'], getenv('BLACKCAT_MAILING_WORKER_NAME') ?: 'blackcat-mailing-worker') ?: 'blackcat-mailing-worker';
        $lockSeconds = (int)self::readInt($config, ['lock_seconds', 'lockSeconds'], (int)(getenv('BLACKCAT_MAILING_LOCK_SECONDS') ?: 300));
        $lockSeconds = max(30, $lockSeconds);

        $batchSize = (int)self::readInt($config, ['batch_size', 'batchSize'], (int)(getenv('BLACKCAT_MAILING_BATCH_SIZE') ?: 50));
        $batchSize = max(1, $batchSize);

        $templatesDir = self::readString($config, ['templates_dir', 'templatesDir'], getenv('BLACKCAT_MAILING_TEMPLATES_DIR') ?: null);
        if ($templatesDir !== null) {
            $templatesDir = trim($templatesDir);
            if ($templatesDir === '') {
                $templatesDir = null;
            }
        }

        return new MailingConfig(
            $smtpHost,
            $smtpPort > 0 ? $smtpPort : 587,
            $smtpUser !== null && trim($smtpUser) !== '' ? $smtpUser : null,
            $smtpPass !== null && trim($smtpPass) !== '' ? $smtpPass : null,
            $smtpEnc,
            $fromEmail,
            $fromName,
            $workerName,
            $lockSeconds,
            $batchSize,
            $templatesDir
        );
    }

    /**
     * @param array<string,mixed> $payloadArr
     * @return array<string,mixed>
     */
    private static function mapLegacyPayload(array $payloadArr): array
    {
        $to = (string)($payloadArr['to_email'] ?? $payloadArr['to'] ?? '');
        $to = trim($to);

        $vars = is_array($payloadArr['vars'] ?? null) ? (array)$payloadArr['vars'] : [];
        if (!isset($vars['subject']) && isset($payloadArr['subject'])) {
            $vars['subject'] = (string)$payloadArr['subject'];
        }

        $out = [
            'to_email' => $to,
            'to_name' => isset($payloadArr['to_name']) ? (string)$payloadArr['to_name'] : null,
            'vars' => $vars,
        ];

        if (isset($payloadArr['meta']) && is_array($payloadArr['meta'])) {
            $out['meta'] = (array)$payloadArr['meta'];
        }
        if (isset($payloadArr['attachments']) && is_array($payloadArr['attachments'])) {
            $out['attachments'] = (array)$payloadArr['attachments'];
        }

        return $out;
    }

    private static function withBatchSize(MailingConfig $cfg, int $batchSize): MailingConfig
    {
        $batchSize = max(1, $batchSize);
        return new MailingConfig(
            $cfg->smtpHost(),
            $cfg->smtpPort(),
            $cfg->smtpUser(),
            $cfg->smtpPass(),
            $cfg->smtpEncryption(),
            $cfg->fromEmail(),
            $cfg->fromName(),
            $cfg->workerName(),
            $cfg->lockSeconds(),
            $batchSize,
            $cfg->templatesDir(),
        );
    }

    private static function readString(array $config, array $keys, ?string $default): ?string
    {
        foreach ($keys as $k) {
            if (!array_key_exists($k, $config)) {
                continue;
            }
            $v = $config[$k];
            if (is_string($v)) {
                $v = trim($v);
                return $v !== '' ? $v : null;
            }
        }
        return $default;
    }

    private static function readInt(array $config, array $keys, int $default): int
    {
        foreach ($keys as $k) {
            if (!array_key_exists($k, $config)) {
                continue;
            }
            $v = $config[$k];
            if (is_int($v)) {
                return $v;
            }
            if (is_string($v) && ctype_digit($v)) {
                return (int)$v;
            }
        }
        return $default;
    }

    private static function readBool(array $config, array $keys, bool $default): bool
    {
        foreach ($keys as $k) {
            if (!array_key_exists($k, $config)) {
                continue;
            }
            $v = $config[$k];
            if (is_bool($v)) {
                return $v;
            }
            if (is_int($v)) {
                return $v !== 0;
            }
            if (is_string($v)) {
                $vv = strtolower(trim($v));
                if (in_array($vv, ['1', 'true', 'yes', 'y', 'on'], true)) {
                    return true;
                }
                if (in_array($vv, ['0', 'false', 'no', 'n', 'off'], true)) {
                    return false;
                }
            }
        }
        return $default;
    }
}

