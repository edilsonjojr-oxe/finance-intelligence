import nodemailer from "nodemailer";
import { isHostedDeployment } from "./deployment-config";

/**
 * Envio de e-mail por SMTP (ex.: Gmail com "senha de app"). Configuração só por variáveis de
 * ambiente: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS e MAIL_FROM (opcional).
 * Sem configuração, em ambiente local o conteúdo vai para o console do servidor (teste);
 * hospedado, o envio é recusado.
 */
export const mailConfigured = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!mailConfigured()) {
    if (isHostedDeployment()) throw new Error("mail-not-configured");
    console.info(`[e-mail local, não enviado] para ${to}: ${subject}\n${text}`);
    return;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || `Finance Intelligence <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
    html,
  });
}
