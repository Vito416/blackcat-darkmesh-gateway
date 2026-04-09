<?php
declare(strict_types=1);

namespace BlackCat\Crypto\Kms;

use BlackCat\Crypto\Contracts\KmsClientInterface;
use BlackCat\Crypto\Support\Payload;
use RuntimeException;

final class HttpKmsClient implements KmsClientInterface
{
    /** @param array<string,mixed> $config */
    public function __construct(private readonly array $config)
    {
    }

    public function id(): string
    {
        return (string)($this->config['id'] ?? $this->config['endpoint'] ?? 'http-kms');
    }

    /** @return array<string,mixed> */
    public function wrap(string $context, Payload $payload): array
    {
        $req = [
            'context' => $context,
            'payload' => base64_encode($payload->ciphertext),
            'nonce' => base64_encode($payload->nonce),
            'keyId' => $payload->keyId,
        ];
        $response = $this->request('/wrap', $req, 'POST');
        return $response + ['client' => $this->id()];
    }

    /** @param array<string,mixed> $metadata */
    public function unwrap(string $context, array $metadata): Payload
    {
        $resp = $this->request('/unwrap', [
            'context' => $context,
            'payload' => $metadata['ciphertext'] ?? '',
            'nonce' => $metadata['nonce'] ?? '',
            'keyId' => $metadata['keyId'] ?? '',
        ]);
        $nonceRaw = (string)($resp['nonce'] ?? '');
        $nonceDecoded = base64_decode($nonceRaw, true);
        return new Payload(
            ciphertext: base64_decode((string)$resp['payload'], true) ?: '',
            nonce: $nonceDecoded !== false ? $nonceDecoded : $nonceRaw,
            keyId: (string)($resp['keyId'] ?? ''),
        );
    }

    /** @return array<string,mixed> */
    public function health(): array
    {
        return $this->request('/healthz', [], 'GET');
    }

    /**
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    private function request(string $path, array $body = [], string $method = 'POST'): array
    {
        $endpoint = rtrim((string)($this->config['endpoint'] ?? ''), '/');
        if ($endpoint === '') {
            throw new RuntimeException('HttpKmsClient requires endpoint');
        }
        $method = strtoupper($method);
        if ($method === '') {
            throw new RuntimeException('HttpKmsClient requires non-empty HTTP method');
        }
        $url = $endpoint . $path;
        $payload = $method === 'GET'
            ? ''
            : json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($payload === false) {
            throw new RuntimeException('Unable to encode KMS payload.');
        }
        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
            'User-Agent: BlackCatCrypto/1.0',
        ];
        $basicAuth = null;
        if (!empty($this->config['token'])) {
            $headers[] = 'Authorization: Bearer ' . $this->config['token'];
        } elseif (!empty($this->config['basic_user']) || !empty($this->config['basic_pass'])) {
            $basicAuth = (string)($this->config['basic_user'] ?? '') . ':' . (string)($this->config['basic_pass'] ?? '');
        }
        if (!empty($this->config['headers']) && is_iterable($this->config['headers'])) {
            foreach ($this->config['headers'] as $name => $value) {
                $headers[] = sprintf('%s: %s', $name, $value);
            }
        }
        $connectTimeout = max(1, (int)($this->config['connect_timeout'] ?? $this->config['timeout'] ?? 5));
        $readTimeout = max(1, (int)($this->config['read_timeout'] ?? $connectTimeout));
        $verifyPeer = (bool)($this->config['verify_peer'] ?? true);
        $caPath = isset($this->config['ca_path']) ? (string)$this->config['ca_path'] : null;
        $certPath = isset($this->config['cert_path']) ? (string)$this->config['cert_path'] : null;
        $keyPath = isset($this->config['key_path']) ? (string)$this->config['key_path'] : null;

        [$status, $response] = $this->sendRequest(
            url: $url,
            method: $method,
            payload: $payload,
            headers: $headers,
            connectTimeout: $connectTimeout,
            readTimeout: $readTimeout,
            verifyPeer: $verifyPeer,
            caPath: $caPath,
            certPath: $certPath,
            keyPath: $keyPath,
            basicAuth: $basicAuth,
        );
        $data = json_decode($response, true);
        if (!is_array($data)) {
            throw new RuntimeException('Invalid response from KMS: ' . $response);
        }
        if ($status >= 400) {
            $message = is_string($data['error'] ?? null) ? $data['error'] : ('HTTP ' . $status);
            throw new RuntimeException('KMS error: ' . $message);
        }
        return $data;
    }

    /**
     * @param list<string> $headers
     * @param non-empty-string $url
     * @param non-empty-string $method
     * @return array{0:int,1:string}
     */
    private function sendRequest(
        string $url,
        string $method,
        string $payload,
        array $headers,
        int $connectTimeout,
        int $readTimeout,
        bool $verifyPeer,
        ?string $caPath,
        ?string $certPath,
        ?string $keyPath,
        ?string $basicAuth
    ): array
    {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
            curl_setopt($ch, CURLOPT_TIMEOUT, $readTimeout);
            curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $connectTimeout);
            curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
            curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $verifyPeer);
            curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $verifyPeer ? 2 : 0);
            if ($caPath) {
                curl_setopt($ch, CURLOPT_CAINFO, $caPath);
            }
            if ($certPath) {
                curl_setopt($ch, CURLOPT_SSLCERT, $certPath);
            }
            if ($keyPath) {
                curl_setopt($ch, CURLOPT_SSLKEY, $keyPath);
            }
            if ($basicAuth) {
                curl_setopt($ch, CURLOPT_USERPWD, $basicAuth);
            }
            if ($method === 'GET') {
                curl_setopt($ch, CURLOPT_HTTPGET, true);
            } else {
                curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
            }
            $response = curl_exec($ch);
            if ($response === false) {
                $error = curl_error($ch);
                curl_close($ch);
                throw new RuntimeException('KMS request failed: ' . $error);
            }
            if ($response === true) {
                curl_close($ch);
                throw new RuntimeException('KMS request failed: unexpected boolean response.');
            }
            $status = curl_getinfo($ch, CURLINFO_HTTP_CODE) ?: 0;
            curl_close($ch);
            return [$status, $response];
        }

        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'content' => $method === 'GET' ? '' : $payload,
                'timeout' => $readTimeout,
                'ignore_errors' => true,
            ],
            'ssl' => [
                'verify_peer' => $verifyPeer,
                'verify_peer_name' => $verifyPeer,
                'cafile' => $caPath,
                'local_cert' => $certPath,
                'local_pk' => $keyPath,
                'allow_self_signed' => !$verifyPeer,
            ],
        ]);
        $response = @file_get_contents($url, false, $context);
        if ($response === false) {
            $error = error_get_last()['message'] ?? 'stream error';
            throw new RuntimeException('KMS request failed: ' . $error);
        }
        $statusLine = $http_response_header[0] ?? 'HTTP/1.1 200';
        preg_match('~\s(\d{3})\s~', $statusLine, $match);
        $status = isset($match[1]) ? (int)$match[1] : 0;
        return [$status, $response];
    }
}
