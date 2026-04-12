<?php
declare(strict_types=1);

namespace BlackCat\Mailing\Transport;

use PHPMailer\PHPMailer\PHPMailer;

final class SmtpTransport implements TransportInterface
{
    public function __construct(
        private readonly string $host,
        private readonly int $port,
        private readonly ?string $user,
        private readonly ?string $pass,
        private readonly string $encryption,
    ) {}

    public function send(OutgoingEmail $email): void
    {
        $mail = new PHPMailer(true);
        $mail->isSMTP();
        $mail->Host = $this->host;
        $mail->Port = $this->port;

        $enc = strtolower($this->encryption);
        if ($enc === 'tls') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
        } elseif ($enc === 'ssl') {
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
        } else {
            $mail->SMTPSecure = '';
        }

        if ($this->user !== null && $this->user !== '') {
            $mail->SMTPAuth = true;
            $mail->Username = $this->user;
            $mail->Password = (string)($this->pass ?? '');
        }

        $mail->CharSet = 'UTF-8';
        $mail->setFrom($email->fromEmail, $email->fromName);
        $mail->addAddress($email->toEmail, $email->toName ?? '');
        $mail->Subject = $email->subject;
        $mail->Body = $email->htmlBody;
        $mail->AltBody = $email->textBody;
        $mail->isHTML(true);

        $mail->send();
    }
}

