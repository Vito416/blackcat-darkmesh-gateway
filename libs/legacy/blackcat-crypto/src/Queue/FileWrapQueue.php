<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Queue;

final class FileWrapQueue implements WrapQueueInterface
{
    private string $path;

    public function __construct(string $path)
    {
        $this->path = $path;
        $dir = dirname($this->path);
        if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
            throw new \RuntimeException('Unable to create wrap queue directory: ' . $dir);
        }
        if (!file_exists($this->path) && @touch($this->path) === false) {
            throw new \RuntimeException('Unable to create wrap queue file: ' . $this->path);
        }
    }

    public function enqueue(WrapJob $job): void
    {
        $handle = $this->open(LOCK_EX);
        try {
            fseek($handle, 0, SEEK_END);
            $record = json_encode($job->toArray(), JSON_UNESCAPED_SLASHES) . PHP_EOL;
            fwrite($handle, $record);
            fflush($handle);
        } finally {
            $this->close($handle);
        }
    }

    public function dequeue(): ?WrapJob
    {
        $handle = $this->open(LOCK_EX);
        try {
            rewind($handle);
            $first = null;
            $rest = '';
            while (($line = fgets($handle)) !== false) {
                if (trim($line) === '') {
                    continue;
                }
                if ($first === null) {
                    $first = $line;
                } else {
                    $rest .= $line;
                }
            }
            ftruncate($handle, 0);
            rewind($handle);
            if ($rest !== '') {
                fwrite($handle, $rest);
            }
            fflush($handle);
        } finally {
            $this->close($handle);
        }
        if ($first === null) {
            return null;
        }
        $data = json_decode($first, true);
        if (!is_array($data)) {
            return null;
        }
        return WrapJob::fromArray($data);
    }

    public function size(): int
    {
        $handle = $this->open(LOCK_SH);
        try {
            rewind($handle);
            $count = 0;
            while (($line = fgets($handle)) !== false) {
                if (trim($line) !== '') {
                    $count++;
                }
            }
            return $count;
        } finally {
            $this->close($handle);
        }
    }

    public function peek(int $limit = 25): array
    {
        $handle = $this->open(LOCK_SH);
        try {
            rewind($handle);
            $jobs = [];
            $limit = max(1, $limit);
            while (($line = fgets($handle)) !== false && count($jobs) < $limit) {
                if (trim($line) === '') {
                    continue;
                }
                $data = json_decode($line, true);
                if (is_array($data)) {
                    $jobs[] = WrapJob::fromArray($data);
                }
            }
            return $jobs;
        } finally {
            $this->close($handle);
        }
    }

    /**
     * @param int<0,7> $lock
     * @return resource
     */
    private function open(int $lock)
    {
        $handle = fopen($this->path, 'c+');
        if ($handle === false) {
            throw new \RuntimeException('Unable to open wrap queue at ' . $this->path);
        }
        if (!flock($handle, $lock)) {
            fclose($handle);
            throw new \RuntimeException('Unable to lock wrap queue file.');
        }
        return $handle;
    }

    /** @param resource $handle */
    private function close($handle): void
    {
        flock($handle, LOCK_UN);
        fclose($handle);
    }
}
