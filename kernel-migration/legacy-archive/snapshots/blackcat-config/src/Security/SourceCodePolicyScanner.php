<?php

declare(strict_types=1);

namespace BlackCat\Config\Security;

/**
 * Development-time scanner for "bypass-by-design" policy violations.
 *
 * This is NOT a sandbox. It is a CI / audit helper to prevent introducing code paths that bypass:
 * - the BlackCat kernel DB wrapper (`BlackCat\Core\Database`)
 * - the kernel Trust Kernel guards around secrets access (KeyManager)
 */
final class SourceCodePolicyScanner
{
    public const RULE_RAW_PDO = 'raw_pdo';
    public const RULE_RAW_PDO_ACCESS = 'raw_pdo_access';
    public const RULE_RAW_MYSQLI = 'raw_mysqli';
    public const RULE_RAW_SQLITE3 = 'raw_sqlite3';
    public const RULE_RAW_PG_CONNECT = 'raw_pg_connect';
    public const RULE_KEY_FILE_READ = 'key_file_read';

    /**
     * @param array{
     *   ignore_dirs?:list<string>,
     *   file_extensions?:list<string>,
     *   max_files?:int
     * } $options
     * @return array{
     *   root:string,
     *   violations:list<array{rule:string,file:string,line:int,message:string}>,
     *   stats:array{files_scanned:int,files_skipped:int,dirs_skipped:int}
     * }
     */
    public static function scan(string $rootDir, array $options = []): array
    {
        $rootDir = trim($rootDir);
        if ($rootDir === '' || str_contains($rootDir, "\0")) {
            throw new \InvalidArgumentException('Root directory is invalid.');
        }

        $real = realpath($rootDir);
        if ($real === false || !is_dir($real)) {
            throw new \RuntimeException('Root directory does not exist: ' . $rootDir);
        }

        $ignoreDirs = $options['ignore_dirs'] ?? [
            '.git',
            'vendor',
            'node_modules',
            'out',
            'dist',
            'build',
            'cache',
            '.cache',
        ];

        $exts = $options['file_extensions'] ?? ['php'];
        $exts = array_values(array_unique(array_map(static fn (string $e): string => strtolower(ltrim($e, '.')), $exts)));
        if ($exts === []) {
            throw new \InvalidArgumentException('file_extensions must not be empty.');
        }

        $maxFiles = $options['max_files'] ?? 20000;
        if (!is_int($maxFiles) || $maxFiles < 1) {
            throw new \InvalidArgumentException('max_files must be a positive integer.');
        }

        $violations = [];
        $filesScanned = 0;
        $filesSkipped = 0;
        $dirsSkipped = 0;

        $dirIt = new \RecursiveDirectoryIterator($real, \FilesystemIterator::SKIP_DOTS);
        $it = new \RecursiveIteratorIterator($dirIt);

        /** @var \SplFileInfo $file */
        foreach ($it as $file) {
            if ($file->isDir()) {
                continue;
            }

            $path = $file->getPathname();
            $rel = ltrim(str_replace('\\', '/', substr($path, strlen($real))), '/');

            $parts = explode('/', $rel);
            if ($parts !== []) {
                $top = $parts[0] ?? '';
                if ($top !== '' && in_array($top, $ignoreDirs, true)) {
                    $filesSkipped++;
                    continue;
                }
            }

            $ext = strtolower($file->getExtension());
            if (!in_array($ext, $exts, true)) {
                $filesSkipped++;
                continue;
            }

            $filesScanned++;
            if ($filesScanned > $maxFiles) {
                throw new \RuntimeException('File scan limit exceeded (max_files=' . $maxFiles . ').');
            }

            $code = @file_get_contents($path);
            if (!is_string($code)) {
                $filesSkipped++;
                continue;
            }

            foreach (self::scanCodeForViolations($code, $path) as $violation) {
                $violations[] = $violation;
            }
        }

        // Approx dirs skipped (best effort): count ignore dirs that exist under root.
        foreach ($ignoreDirs as $d) {
            if (is_dir($real . DIRECTORY_SEPARATOR . $d)) {
                $dirsSkipped++;
            }
        }

        return [
            'root' => $real,
            'violations' => $violations,
            'stats' => [
                'files_scanned' => $filesScanned,
                'files_skipped' => $filesSkipped,
                'dirs_skipped' => $dirsSkipped,
            ],
        ];
    }

    /**
     * @return list<array{rule:string,file:string,line:int,message:string}>
     */
    private static function scanCodeForViolations(string $code, string $file): array
    {
        $out = [];
        $tokens = token_get_all($code);

        $keyReadFunctions = [
            'file_get_contents',
            'fopen',
            'readfile',
            'file',
        ];

        $count = count($tokens);
        for ($i = 0; $i < $count; $i++) {
            $tok = $tokens[$i];
            if (!is_array($tok)) {
                continue;
            }

            $type = $tok[0];
            $text = $tok[1];
            $line = (int) $tok[2];

            if ($type === T_NEW) {
                $name = self::readNextClassName($tokens, $i + 1);
                if ($name !== null && strtolower(ltrim($name, '\\')) === 'pdo') {
                    $out[] = [
                        'rule' => self::RULE_RAW_PDO,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Raw PDO instantiation is forbidden; use BlackCat\\Core\\Database.',
                    ];
                }
                if ($name !== null && strtolower(ltrim($name, '\\')) === 'mysqli') {
                    $out[] = [
                        'rule' => self::RULE_RAW_MYSQLI,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Raw mysqli instantiation is forbidden; use BlackCat\\Core\\Database.',
                    ];
                }
                if ($name !== null && strtolower(ltrim($name, '\\')) === 'sqlite3') {
                    $out[] = [
                        'rule' => self::RULE_RAW_SQLITE3,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Raw SQLite3 instantiation is forbidden; use BlackCat\\Core\\Database.',
                    ];
                }
                continue;
            }

            if ($type === T_STRING && strtolower($text) === 'getpdo') {
                $prev = self::prevNonTriviaToken($tokens, $i - 1);
                $next = self::nextNonTriviaToken($tokens, $i + 1);

                if (
                    is_array($prev)
                    && in_array($prev[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR], true)
                    && $next === '('
                ) {
                    $out[] = [
                        'rule' => self::RULE_RAW_PDO_ACCESS,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Raw PDO access via getPdo() is forbidden; use BlackCat\\Core\\Database wrapper methods.',
                    ];
                }
                continue;
            }

            if ($type === T_STRING && self::isStandaloneFunctionCall($tokens, $i)) {
                $fn = strtolower($text);

                if ($fn === 'mysqli_connect') {
                    $out[] = [
                        'rule' => self::RULE_RAW_MYSQLI,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Direct mysqli_connect() is forbidden; use BlackCat\\Core\\Database.',
                    ];
                    continue;
                }

                if ($fn === 'pg_connect' || $fn === 'pg_pconnect') {
                    $out[] = [
                        'rule' => self::RULE_RAW_PG_CONNECT,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Direct pg_connect()/pg_pconnect() is forbidden; use BlackCat\\Core\\Database.',
                    ];
                    continue;
                }
            }

            if ($type === T_STRING && in_array(strtolower($text), $keyReadFunctions, true)) {
                $hasKeyLiteral = self::functionCallHasKeyLiteral($tokens, $i + 1);
                if ($hasKeyLiteral) {
                    $out[] = [
                        'rule' => self::RULE_KEY_FILE_READ,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Direct .key file reads are forbidden; use BlackCat\\Core\\Security\\KeyManager.',
                    ];
                }
            }
        }

        return $out;
    }

    /**
     * @param array<int,mixed> $tokens
     * @return mixed
     */
    private static function prevNonTriviaToken(array $tokens, int $start): mixed
    {
        for ($i = $start; $i >= 0; $i--) {
            $t = $tokens[$i];
            if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            return $t;
        }
        return null;
    }

    /**
     * @param array<int,mixed> $tokens
     * @return mixed
     */
    private static function nextNonTriviaToken(array $tokens, int $start): mixed
    {
        $count = count($tokens);
        for ($i = $start; $i < $count; $i++) {
            $t = $tokens[$i];
            if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            return $t;
        }
        return null;
    }

    /**
     * Returns true if the token at index $i is a standalone function call (not a method/static call).
     *
     * @param array<int,mixed> $tokens
     */
    private static function isStandaloneFunctionCall(array $tokens, int $i): bool
    {
        $prev = self::prevNonTriviaToken($tokens, $i - 1);
        $next = self::nextNonTriviaToken($tokens, $i + 1);

        if ($next !== '(') {
            return false;
        }

        if (
            is_array($prev)
            && in_array($prev[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON], true)
        ) {
            return false;
        }

        return true;
    }

    /**
     * @param array<int,mixed> $tokens
     */
    private static function readNextClassName(array $tokens, int $start): ?string
    {
        $count = count($tokens);

        // Skip whitespace and comments.
        for ($i = $start; $i < $count; $i++) {
            $t = $tokens[$i];
            if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }

            // PHP 8 name tokens
            if (is_array($t) && in_array($t[0], [T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_NAME_RELATIVE], true)) {
                return (string) $t[1];
            }

            // Classic: optional backslash + T_STRING.
            $name = '';
            if ($t === '\\' || (is_array($t) && $t[0] === T_NS_SEPARATOR)) {
                $name .= '\\';
                $i++;
                if (!isset($tokens[$i])) {
                    return null;
                }
                $t = $tokens[$i];
            }
            if (is_array($t) && $t[0] === T_STRING) {
                $name .= (string) $t[1];
                return $name !== '' ? $name : null;
            }

            return null;
        }

        return null;
    }

    /**
     * Best-effort check: detect `file_get_contents("... .key ...")` literal usage.
     *
     * @param array<int,mixed> $tokens
     */
    private static function functionCallHasKeyLiteral(array $tokens, int $start): bool
    {
        $count = count($tokens);

        // Skip whitespace/comments, then require "(".
        $i = $start;
        for (; $i < $count; $i++) {
            $t = $tokens[$i];
            if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            break;
        }
        if ($i >= $count || $tokens[$i] !== '(') {
            return false;
        }

        // Look ahead for a string literal containing ".key" before the first closing ")".
        $depth = 0;
        for ($j = $i; $j < $count; $j++) {
            $t = $tokens[$j];
            if ($t === '(') {
                $depth++;
                continue;
            }
            if ($t === ')') {
                $depth--;
                if ($depth <= 0) {
                    return false;
                }
                continue;
            }

            if ($depth <= 0) {
                return false;
            }

            if (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
                $literal = (string) $t[1];
                if (stripos($literal, '.key') !== false) {
                    return true;
                }
            }
        }

        return false;
    }
}
