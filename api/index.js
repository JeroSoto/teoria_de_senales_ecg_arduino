// ============================================================
// Función serverless de Vercel: la API de la página publicada.
//   /api/auth/*        crear cuenta, iniciar y cerrar sesión
//   /api/mediciones/*  historial de frecuencia cardíaca
//   /api/admin/*       gestión de usuarios (administradores)
// Guarda todo en la base MySQL indicada en la variable de entorno DATABASE_URL
// (Vercel → Settings → Environment Variables). Es la misma app de `npm start`,
// sin el Arduino por el servidor: en la nube el Arduino se conecta por USB desde el navegador.
// ============================================================
const { crearAppNube } = require('../ecg-signal-simulator/src/app');

module.exports = crearAppNube();
