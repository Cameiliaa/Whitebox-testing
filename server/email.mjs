import nodemailer from 'nodemailer';

export function createEmailSender({ env = process.env, sendMail } = {}) {
  let transporter;

  return async message => {
    if (sendMail) return sendMail(message);
    const { SMTP_USER, SMTP_PASS, SMTP_FROM } = env;
    if (!SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP_USER dan SMTP_PASS belum dikonfigurasi.');
    }
    const port = Number(env.SMTP_PORT || 465);
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: env.SMTP_HOST || 'smtp.gmail.com',
        port,
        secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });
    }
    return transporter.sendMail({ from: SMTP_FROM || SMTP_USER, ...message });
  };
}

export function escapeEmailHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}
