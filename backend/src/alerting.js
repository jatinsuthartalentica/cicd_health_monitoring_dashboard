import axios from 'axios';
import nodemailer from 'nodemailer';
import fs from 'fs';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ALERT_EMAIL_TO = process.env.ALERT_EMAIL_TO;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = process.env.SMTP_USER;
function readSecretFile(path){ try { return fs.readFileSync(path, 'utf8').trim(); } catch { return null } }
const SMTP_PASS = (() => {
  const f = process.env.SMTP_PASS_FILE || '/run/secrets/smtp_pass';
  const fileVal = readSecretFile(f);
  if (fileVal) return fileVal;
  return process.env.SMTP_PASS;
})();
const ALERT_MAX_AGE_MINUTES = Number(process.env.ALERT_MAX_AGE_MINUTES || 60); // no SMTP for older

export async function sendSlack(text) {
  if (!SLACK_WEBHOOK_URL) return false;
  try {
    await axios.post(SLACK_WEBHOOK_URL, { text }, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function sendEmail(subject, body) {
  if (!(ALERT_EMAIL_TO && SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS)) return false;
  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.sendMail({ from: SMTP_USER, to: ALERT_EMAIL_TO, subject, text: body });
    return true;
  } catch {
    return false;
  }
}

export async function notifyFailure(build) {
  const startedAt = build.startedAt ? new Date(build.startedAt) : (build.started_at ? new Date(build.started_at) : new Date());
  const ageMin = Math.max(0, (Date.now() - startedAt.getTime()) / 60000);
  const message = `🚨 CI/CD Failure\nProvider: ${build.provider}\nPipeline: ${build.pipeline}\nBranch: ${build.branch}\nCommit: ${build.commit}\nStatus: ${build.status}\nDuration: ${build.duration_sec || build.durationSec || ''}s\nStarted: ${startedAt.toISOString()}`;
  const s = await sendSlack(message);
  let e = false;
  if (ageMin <= ALERT_MAX_AGE_MINUTES) {
    e = await sendEmail('CI/CD Failure', message);
  }
  if (!(s || e)) console.log('[alert]', message);
}
