// Lista los puertos seriales y marca cuál parece ser el Arduino.
//   npm run puertos
const { SerialPort } = require('serialport');
const { elegirPuertoArduino } = require('../src/services/serialTransport');

SerialPort.list()
  .then((puertos) => {
    if (!puertos.length) return console.log('No se encontraron puertos. ¿El Arduino está conectado por USB?');
    const arduino = elegirPuertoArduino(puertos);
    console.log('Puertos disponibles:');
    for (const p of puertos) {
      const bluetooth = /BTHENUM|bluetooth/i.test(`${p.pnpId || ''} ${p.friendlyName || ''}`);
      const marca = arduino && arduino.path === p.path ? '  ← Arduino' : bluetooth ? '  (Bluetooth, no es el Arduino)' : '';
      console.log(` • ${p.path}${p.manufacturer ? `  (${p.manufacturer})` : ''}${marca}`);
    }
    console.log(
      arduino
        ? `\nCon ARDUINO_PORT=auto el servidor usará ${arduino.path}.`
        : '\nNo se reconoció ningún Arduino. Conéctalo por USB (con un cable de datos, no solo de carga).'
    );
  })
  .catch((err) => console.error('Error al listar puertos:', err.message));
