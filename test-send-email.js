require('dotenv').config();
const { sendEmail } = require('./src/integrations/email');

(async () => {
  try {
    await sendEmail(
      'TU_CORREO_REAL@ejemplo.com',
      '🚨 Prueba de Alerta - Familia Segura',
      'Hola, este es un email de prueba enviado mediante Brevo SMTP.'
    );
    console.log('✅ Email enviado correctamente');
  } catch (err) {
    console.error('❌ Error al enviar email:', err);
  }
})();
