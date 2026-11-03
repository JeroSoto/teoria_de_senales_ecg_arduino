# Arduino + AD8232 — conexión y carga del sketch

> Proyecto educativo. No es un dispositivo médico ni sirve para diagnóstico.
> Seguridad: conecta los electrodos **solo** a un Arduino alimentado por USB desde una PC, preferiblemente un portátil funcionando con batería. Nunca conectes el circuito a la red eléctrica ni a otros equipos alimentados por ella.

## Cableado

| AD8232 | Arduino Uno/Nano |
|--------|------------------|
| 3.3V   | 3.3V |
| GND    | GND |
| OUTPUT | A0 |
| LO+    | D10 |
| LO-    | D11 |

| Actuador | Pin | Notas |
|----------|-----|-------|
| LED controlado desde la web | D8 | Con resistencia de 220 Ω a GND |
| LED de latido | D9 | Con resistencia de 220 Ω a GND; parpadea con cada onda R |

Electrodos: conecta el cable de 3 derivaciones (RA, LA, RL) a las almohadillas adhesivas.

## Cargar el sketch

1. Instala el [Arduino IDE](https://www.arduino.cc/en/software).
2. Abre `ecg_serial/ecg_serial.ino`.
3. *Herramientas → Placa*: Arduino Uno (o Nano). *Herramientas → Puerto*: el de tu placa.
4. Pulsa **Subir**. Para verificar, abre el Monitor Serie a **115200** y debes ver `I,ECG_ARDUINO,1.0,fs=250` seguido de líneas `S,<número>`. Escribe `PING` + Enter: responde `A,PING,OK,pong`.
5. **Cierra el Monitor Serie** antes de iniciar el servidor Node.js (un solo programa puede usar el puerto).

## Conectar con el proyecto

1. Conecta la placa por USB y busca el puerto que aparece para ella en *Herramientas → Puerto* del Arduino IDE. En Windows suele ser `COM` seguido de un número.
2. Desde la carpeta `ecg-signal-simulator`, ejecuta `npm run puertos` y confirma que aparece el mismo puerto de la placa. Los puertos Bluetooth virtuales no son el Arduino.
3. En `.env`, establece `ARDUINO_MODE=serial` y `ARDUINO_PORT=COMx`, sustituyendo `COMx` por el puerto verificado. Mantén `ARDUINO_BAUD=115200`.
4. Cierra el Monitor Serie y reinicia el servidor con `npm start`. Inicia sesión, pulsa **Probar conexión (PING)** y luego **Usar señal del Arduino** para mostrar las muestras reales.

Si todavía no conectas la placa, deja `ARDUINO_MODE=simulate`; el servidor puede iniciar y mostrar la señal simulada sin hardware.

El protocolo completo está en el README principal (sección 5.3).
