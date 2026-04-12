<?php
declare(strict_types=1);

namespace BlackCat\Auth\DeviceCode;

interface DeviceCodeStoreInterface
{
    public function save(DeviceCodeEntry $entry): void;
    public function findByDeviceCode(string $deviceCode): ?DeviceCodeEntry;
    public function findByUserCode(string $userCode): ?DeviceCodeEntry;
    public function delete(string $deviceCode): void;
}
