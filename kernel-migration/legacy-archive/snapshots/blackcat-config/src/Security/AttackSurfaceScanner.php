<?php

declare(strict_types=1);

namespace BlackCat\Config\Security;

/**
 * Development-time scanner for common high-risk PHP patterns.
 *
 * This is NOT a sandbox. It is a CI / audit helper.
 *
 * Design goals:
 * - keep false-positives low for "obviously unsafe" constructs (eval, preg_replace /e, create_function)
 * - treat ambiguous patterns (dynamic include, unserialize) as warnings
 * - ignore vendor/node_modules and other build outputs by default
 */
final class AttackSurfaceScanner
{
    public const RULE_EVAL = 'eval';
    public const RULE_CREATE_FUNCTION = 'create_function';
    public const RULE_PREG_REPLACE_E = 'preg_replace_e';
    public const RULE_DYNAMIC_INCLUDE = 'dynamic_include';
    public const RULE_UNSERIALIZE = 'unserialize';
    public const RULE_SHELL_EXEC = 'shell_exec';
    public const RULE_ASSERT = 'assert';

    /**
     * @param array{
     *   ignore_dirs?:list<string>,
     *   file_extensions?:list<string>,
     *   max_files?:int
     * } $options
     * @return array{
     *   root:string,
     *   findings:list<array{severity:'warn'|'error',rule:string,file:string,line:int,message:string}>,
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

        $findings = [];
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

            foreach (self::scanCodeForFindings($code, $path) as $finding) {
                $findings[] = $finding;
            }
        }

        foreach ($ignoreDirs as $d) {
            if (is_dir($real . DIRECTORY_SEPARATOR . $d)) {
                $dirsSkipped++;
            }
        }

        return [
            'root' => $real,
            'findings' => $findings,
            'stats' => [
                'files_scanned' => $filesScanned,
                'files_skipped' => $filesSkipped,
                'dirs_skipped' => $dirsSkipped,
            ],
        ];
    }

    /**
     * @return list<array{severity:'warn'|'error',rule:string,file:string,line:int,message:string}>
     */
    private static function scanCodeForFindings(string $code, string $file): array
    {
        $out = [];
        $tokens = token_get_all($code);
        $count = count($tokens);

        for ($i = 0; $i < $count; $i++) {
            $tok = $tokens[$i];
            if (!is_array($tok)) {
                continue;
            }

            $type = $tok[0];
            $text = $tok[1];
            $line = (int) $tok[2];

            if ($type === T_EVAL) {
                $out[] = [
                    'severity' => 'error',
                    'rule' => self::RULE_EVAL,
                    'file' => $file,
                    'line' => $line,
                    'message' => 'Use of eval is forbidden (high-risk code execution primitive).',
                ];
                continue;
            }

            if ($type === T_STRING && self::isStandaloneFunctionCall($tokens, $i)) {
                $fn = strtolower($text);

                if ($fn === 'create_function') {
                    $out[] = [
                        'severity' => 'error',
                        'rule' => self::RULE_CREATE_FUNCTION,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Use of create_function is forbidden (dynamic code execution).',
                    ];
                    continue;
                }

                if ($fn === 'preg_replace') {
                    if (self::pregReplaceHasEvalModifier($tokens, $i + 1)) {
                        $out[] = [
                            'severity' => 'error',
                            'rule' => self::RULE_PREG_REPLACE_E,
                            'file' => $file,
                            'line' => $line,
                            'message' => 'preg_replace /e modifier is forbidden (dynamic code execution).',
                        ];
                    }
                    continue;
                }

                if ($fn === 'unserialize') {
                    $out[] = [
                        'severity' => 'warn',
                        'rule' => self::RULE_UNSERIALIZE,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'unserialize() is risky; ensure allowed_classes=false and inputs are trusted.',
                    ];
                    continue;
                }

                if ($fn === 'assert') {
                    $out[] = [
                        'severity' => 'warn',
                        'rule' => self::RULE_ASSERT,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'assert() can be a code execution primitive in some configurations; avoid using it for runtime checks.',
                    ];
                    continue;
                }

                if (in_array($fn, ['exec', 'shell_exec', 'system', 'passthru', 'popen', 'proc_open'], true)) {
                    $out[] = [
                        'severity' => 'warn',
                        'rule' => self::RULE_SHELL_EXEC,
                        'file' => $file,
                        'line' => $line,
                        'message' => 'Process execution functions increase attack surface; prefer dedicated CLI repo and strict allowlists.',
                    ];
                    continue;
                }
            }

            if (in_array($type, [T_INCLUDE, T_INCLUDE_ONCE, T_REQUIRE, T_REQUIRE_ONCE], true)) {
                // Warn on non-literal includes (e.g., include $path), a common LFI vector.
                $next = self::nextNonTriviaToken($tokens, $i + 1);
                if (is_array($next)) {
                    if (!in_array($next[0], [T_CONSTANT_ENCAPSED_STRING, T_DIR], true)) {
                        $out[] = [
                            'severity' => 'warn',
                            'rule' => self::RULE_DYNAMIC_INCLUDE,
                            'file' => $file,
                            'line' => $line,
                            'message' => 'Dynamic include/require detected; prefer static includes and explicit routing.',
                        ];
                    }
                }
            }
        }

        return $out;
    }

    /**
     * @param array<int,mixed> $tokens
     */
    private static function isStandaloneFunctionCall(array $tokens, int $i): bool
    {
        $prev = self::prevNonTriviaToken($tokens, $i - 1);
        $next = self::nextNonTriviaToken($tokens, $i + 1);

        if ($next !== '(') {
            return false;
        }

        if (is_array($prev) && in_array($prev[0], [T_OBJECT_OPERATOR, T_NULLSAFE_OBJECT_OPERATOR, T_DOUBLE_COLON, T_FUNCTION], true)) {
            return false;
        }

        return true;
    }

    /**
     * Best-effort detection of preg_replace patterns using /e.
     *
     * @param array<int,mixed> $tokens
     */
    private static function pregReplaceHasEvalModifier(array $tokens, int $start): bool
    {
        $t = self::nextNonTriviaToken($tokens, $start);
        if ($t !== '(') {
            return false;
        }

        // Scan for the first string literal argument.
        for ($i = $start + 1; $i < count($tokens); $i++) {
            $tok = $tokens[$i];
            if ($tok === ')') {
                break;
            }
            if (!is_array($tok)) {
                continue;
            }
            if ($tok[0] !== T_CONSTANT_ENCAPSED_STRING) {
                continue;
            }

            $lit = (string) $tok[1];
            // Strip quotes.
            $lit = trim($lit);
            if ($lit === '') {
                return false;
            }
            $q = $lit[0];
            if (($q === '"' || $q === "'") && str_ends_with($lit, $q)) {
                $lit = substr($lit, 1, -1);
            }

            return (bool) preg_match('~/(?:[^/\\\\]|\\\\.)*/e[imsxuADSUXJ]*$~', $lit);
        }

        return false;
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
        for ($i = $start; $i < count($tokens); $i++) {
            $t = $tokens[$i];
            if (is_array($t) && in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)) {
                continue;
            }
            return $t;
        }

        return null;
    }
}
