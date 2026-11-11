# Arduino + AD8232: conexión y carga del sketch

> Proyecto educativo. No es un dispositivo médico ni sirve para diagnóstico.
> Seguridad: conecta los electrodos **solo** a un Arduino alimentado por USB desde una PC, preferiblemente un portátil funcionando con batería. Nunca conectes el circuito a la red eléctrica ni a otros equipos alimentados por ella.

El sketch del proyecto es **`ecg_plotter_teoria/ecg_plotter_teoria.ino`**. Sirve para las dos cosas:

| Modo | Para qué | Cómo se activa |
|------|----------|----------------|
| **Gráfica** | Serial Plotter / Serial Monitor del Arduino IDE: onda filtrada con la derivación en la leyenda, FC, ritmo, QRS, informes de texto | Al encender la placa (o al abrir el Plotter) |
| **Web** | La página del proyecto (`npm start` o la versión publicada en Vercel): protocolo completo a 250 Hz y comandos | La página envía `WEB` sola al conectarse |

No hay que cambiar nada entre uno y otro: solo **un programa a la vez** puede usar el puerto USB.

**Versión 3.0 — frecuencia cardíaca confiable.** La detección de latidos sigue el algoritmo de Pan-Tompkins (pasa-banda 5–15 Hz, derivada, cuadrado, integración, umbral adaptativo) con período refractario de 200 ms y discriminación de la onda T por su pendiente. La FC es la mediana de los últimos 8 intervalos RR y solo se muestra si la señal es confiable; si no, `FC = 0` en el Plotter, `H,0` en la página y el informe de texto (`M`) explica por qué (ruido, latidos irregulares o sin latidos). La versión anterior contaba la onda T y el ruido como latidos y marcaba alrededor de 200 lpm.

## Cableado

| AD8232 | Arduino Uno/Nano |
|--------|------------------|
| 3.3V   | 3.3V |
| GND    | GND |
| OUTPUT | A0 |
| LO+    | D10 (opcional: pon `USAR_LEADS_OFF = true` en el sketch) |
| LO-    | D11 (opcional: pon `USAR_LEADS_OFF = true` en el sketch) |

| Actuador (opcional) | Pin | Notas |
|----------|-----|-------|
| LED controlado desde la web | D8 | Con resistencia de 220 Ω a GND |
| LED de latido | D9 | Con resistencia de 220 Ω a GND; parpadea con cada onda R |

Electrodos: conecta el cable de 3 derivaciones (RA, LA, RL) a las almohadillas adhesivas.

## Cargar el sketch y verlo en el Arduino IDE

1. Instala el [Arduino IDE](https://www.arduino.cc/en/software).
2. Abre `ecg_plotter_teoria/ecg_plotter_teoria.ino`.
3. *Herramientas → Placa*: Arduino Uno (o Nano). *Herramientas → Puerto*: el de tu placa.
4. Pulsa **Subir**.
5. *Herramientas → Serial Plotter* y elige **115200 baud** abajo a la derecha. Verás la onda (`I`, `II`… en la leyenda), `FC` y `Cero`.
   Escribe `II`, `V1`… en *Type Message* para etiquetar la derivación; `M` para informes de texto, `P` para volver a la gráfica, `RESUMEN` y `AYUDA`.
6. Prueba sin sensor: pon `MODO_DEMO = true` y vuelve a subirlo (ECG sintético de 72 lpm con onda T alta: la FC debe marcar 72, no 144).
7. Para medir: quédate quieto y sin hablar; la FC aparece a los ~5 s (2 s de calibración + 4 latidos).

## Ver la señal en la página

1. **Cierra el Serial Plotter y el Monitor Serie** (el Arduino IDE puede seguir abierto). En Windows, si siguen abiertos la página dirá «el puerto está ocupado».
2. Elige una de las dos formas:
   * **Con el servidor:** `npm start` desde la raíz del repositorio. Con `ARDUINO_PORT=auto` (valor por defecto) el servidor encuentra la placa solo; `npm run puertos` muestra cuál eligió (los COM Bluetooth se ignoran). Inicia sesión y el monitor cambia solo a la señal del Arduino. También puedes abrirla desde un celular en el mismo Wi-Fi (la terminal muestra la dirección).
   * **Sin servidor:** abre la página publicada en Chrome o Edge en el computador donde está el Arduino y pulsa **Conectar Arduino**.
3. Para **subir un sketch nuevo** con `npm start` abierto, pulsa **Liberar puerto** en la página, súbelo desde el IDE y luego **Reconectar**.

Si cambiaste la velocidad del sketch (comandos `300` … `57600`), escribe `0` en el Monitor Serie para volver a 115200, que es la que usa la página. De todas formas, la página prueba 115200 y 9600 si no entiende lo que llega.

El protocolo completo está en el README técnico (sección 5.3).
