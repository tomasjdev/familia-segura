const nodemailer = require("nodemailer");

const tx = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendEmail(to, subject, text) {
  if (!to) return;
  await tx.sendMail({ from: process.env.SMTP_FROM, to, subject, text });
}

module.exports = { sendEmail };
