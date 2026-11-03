// Lista los puertos seriales disponibles para poner en ARDUINO_PORT.
//   npm run puertos
const { SerialPort } = require('serialport');

SerialPort.list()
  .then((puertos) => {
    if (!puertos.length) return console.log('No se encontraron puertos. ¿El Arduino está conectado por USB?');
    console.log('Puertos disponibles:');
    for (const p of puertos) {
      console.log(` • ${p.path}${p.manufacturer ? `  (${p.manufacturer})` : ''}`);
    }
    console.log('\nCopia el que corresponda al Arduino en ARDUINO_PORT dentro del archivo .env');
  })
  .catch((err) => console.error('Error al listar puertos:', err.message));
