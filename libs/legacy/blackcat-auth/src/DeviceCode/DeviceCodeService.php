<?php
declare(strict_types=1);

namespace BlackCat\Auth\DeviceCode;

final class DeviceCodeService
{
    public function __construct(
        private readonly DeviceCodeStoreInterface $store,
        private readonly string $verificationUri,
        private readonly int $ttlSeconds = 600,
        private readonly int $intervalSeconds = 5,
    ) {}

    /**
     * @param list<string> $scopes
     * @return array{device_code:string,user_code:string,verification_uri:string,verification_uri_complete:string,expires_in:int,interval:int}
     */
    public function issue(string $clientId, array $scopes): array
    {
        $deviceCode = bin2hex(random_bytes(16));
        $userCode = strtoupper(substr(bin2hex(random_bytes(5)), 0, 8));
        $entry = new DeviceCodeEntry(
            $deviceCode,
            $userCode,
            $clientId,
            $scopes,
            time() + $this->ttlSeconds,
            $this->intervalSeconds
        );
        $this->store->save($entry);
        return [
            'device_code' => $deviceCode,
            'user_code' => $userCode,
            'verification_uri' => $this->verificationUri,
            'verification_uri_complete' => $this->verificationUri . '?user_code=' . $userCode,
            'expires_in' => $this->ttlSeconds,
            'interval' => $this->intervalSeconds,
        ];
    }

    /**
     * @param array<string,mixed> $tokens
     * @return array{status:'approved'}|array{status:'error',error:string}
     */
    public function approve(string $userCode, array $tokens): array
    {
        $entry = $this->store->findByUserCode($userCode);
        if ($entry === null) {
            return ['status' => 'error', 'error' => 'invalid_user_code'];
        }
        if ($entry->isExpired()) {
            $this->store->delete($entry->deviceCode);
            return ['status' => 'error', 'error' => 'expired_token'];
        }
        $this->store->save($entry->markApproved($tokens));
        return ['status' => 'approved'];
    }

    /**
     * @return array{status:'approved',tokens:array<string,mixed>}|array{status:'pending',error:string}|array{status:'error',error:string}
     */
    public function poll(string $deviceCode): array
    {
        $entry = $this->store->findByDeviceCode($deviceCode);
        if ($entry === null) {
            return ['status' => 'error', 'error' => 'invalid_device_code'];
        }
        if ($entry->isExpired()) {
            $this->store->delete($deviceCode);
            return ['status' => 'error', 'error' => 'expired_token'];
        }
        if (!$entry->isApproved()) {
            return ['status' => 'pending', 'error' => 'authorization_pending'];
        }
        if ($entry->isConsumed()) {
            return ['status' => 'error', 'error' => 'invalid_grant'];
        }
        $this->store->delete($deviceCode);
        $tokens = $entry->tokens();
        if (!is_array($tokens)) {
            return ['status' => 'error', 'error' => 'invalid_grant'];
        }
        return ['status' => 'approved', 'tokens' => $tokens];
    }
}
