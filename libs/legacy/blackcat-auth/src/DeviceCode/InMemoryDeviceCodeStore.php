<?php
declare(strict_types=1);

namespace BlackCat\Auth\DeviceCode;

final class InMemoryDeviceCodeStore implements DeviceCodeStoreInterface
{
    /** @var array<string,DeviceCodeEntry> */
    private array $byDevice = [];

    /** @var array<string,string> */
    private array $userToDevice = [];

    public function save(DeviceCodeEntry $entry): void
    {
        $this->byDevice[$entry->deviceCode] = $entry;
        $this->userToDevice[$entry->userCode] = $entry->deviceCode;
    }

    public function findByDeviceCode(string $deviceCode): ?DeviceCodeEntry
    {
        return $this->byDevice[$deviceCode] ?? null;
    }

    public function findByUserCode(string $userCode): ?DeviceCodeEntry
    {
        $deviceCode = $this->userToDevice[$userCode] ?? null;
        return $deviceCode ? $this->findByDeviceCode($deviceCode) : null;
    }

    public function delete(string $deviceCode): void
    {
        $entry = $this->byDevice[$deviceCode] ?? null;
        if ($entry) {
            unset($this->userToDevice[$entry->userCode]);
        }
        unset($this->byDevice[$deviceCode]);
    }
}
