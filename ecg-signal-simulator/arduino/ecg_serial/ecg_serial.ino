/*
 * ============================================================
 *  ECG por puerto serial  —  Arduino Uno / Nano + módulo AD8232
 *  Proyecto educativo de Teoría de Señales (Universidad de Manizales)
 *  NO es un dispositivo médico ni sirve para diagnóstico.
 * ============================================================
 *
 *  PINES
 *    A0   <- salida analógica (OUTPUT) del AD8232
 *    D10  <- LO+  (detección de electrodo suelto)
 *    D11  <- LO-  (detección de electrodo suelto)
 *    D8   -> LED controlado desde la web (comando LED,0 / LED,1)
 *    D9   -> LED de latido: parpadea cada vez que se detecta una onda R
 *    3.3V -> 3.3V del AD8232      GND -> GND del AD8232
 *    (Resistencias de 220 ohm en serie con cada LED)
 *
 *  PROTOCOLO SERIAL (115200 baudios, líneas terminadas en \n)
 *    Arduino -> PC
 *      I,ECG_ARDUINO,1.0,fs=250   anuncio al arrancar
 *      S,<adc>                    muestra del ECG (0-1023), a fs Hz
 *      H,<bpm>                    frecuencia cardíaca calculada a bordo
 *      L,<0|1>                    1 = electrodo desconectado (cambios de estado)
 *      A,<CMD>,<OK|ERR>[,<info>]  confirmación de un comando
 *    PC -> Arduino
 *      PING          responde A,PING,OK,pong
 *      START / STOP  inicia o pausa el envío de muestras
 *      LED,<0|1>     apaga/enciende el LED de D8
 *      FS,<Hz>       cambia la frecuencia de muestreo: 125, 250 o 500
 *
 *  Este sketch mantiene el mismo protocolo que el Arduino simulado del
 *  servidor (src/services/simulatedArduino.js).
 */

#include <Arduino.h>
#include <stdlib.h>
#include <string.h>

// ---------- Pines ----------
const uint8_t PIN_ECG       = A0;
const uint8_t PIN_LO_PLUS   = 10;
const uint8_t PIN_LO_MINUS  = 11;
const uint8_t PIN_LED_WEB   = 8;
const uint8_t PIN_LED_BEAT  = 9;

// ---------- Configuración ----------
const unsigned long BAUDIOS = 115200;
unsigned int fs = 250;                     // frecuencia de muestreo (Hz)
unsigned long periodoUs = 1000000UL / 250; // Ts en microsegundos
bool transmitiendo = true;

// ---------- Estado del muestreo ----------
unsigned long proximaMuestraUs = 0;

// ---------- Detección de latidos (umbral adaptativo simple) ----------
int   maximo = 0, minimo = 1023;           // seguidores de pico y valle
unsigned long ultimoSeguimientoMs = 0;
bool  porEncima = false;
unsigned long ultimoLatidoMs = 0;
unsigned long intervalosRR[4] = {0, 0, 0, 0};
uint8_t nRR = 0, idxRR = 0;
unsigned long apagarLedLatidoMs = 0;

// ---------- Electrodos ----------
bool derivacionesSueltas = false;
unsigned long ultimoAvisoLoMs = 0;

// ---------- Lectura de comandos ----------
char bufferCmd[24];
uint8_t largoCmd = 0;

void setup() {
  Serial.begin(BAUDIOS);
  pinMode(PIN_LO_PLUS, INPUT);
  pinMode(PIN_LO_MINUS, INPUT);
  pinMode(PIN_LED_WEB, OUTPUT);
  pinMode(PIN_LED_BEAT, OUTPUT);
  digitalWrite(PIN_LED_WEB, LOW);
  digitalWrite(PIN_LED_BEAT, LOW);

  Serial.print(F("I,ECG_ARDUINO,1.0,fs="));
  Serial.println(fs);
  proximaMuestraUs = micros() + periodoUs;
}

void loop() {
  leerComandos();
  actualizarLedLatido();

  // Muestreo a intervalos exactos de Ts (sin delay(), para no perder comandos)
  if ((long)(micros() - proximaMuestraUs) >= 0) {
    proximaMuestraUs += periodoUs;
    muestrear();
  }
}

void muestrear() {
  bool sueltas = digitalRead(PIN_LO_PLUS) || digitalRead(PIN_LO_MINUS);
  unsigned long ahora = millis();

  // Avisa cuando cambia el estado de los electrodos y se repite cada 2 s
  if (sueltas != derivacionesSueltas || (sueltas && ahora - ultimoAvisoLoMs > 2000)) {
    derivacionesSueltas = sueltas;
    ultimoAvisoLoMs = ahora;
    Serial.print(F("L,"));
    Serial.println(sueltas ? 1 : 0);
  }
  if (sueltas) return;  // sin electrodos la lectura no es válida

  int adc = analogRead(PIN_ECG);
  if (transmitiendo) {
    Serial.print(F("S,"));
    Serial.println(adc);
  }
  detectarLatido(adc, ahora);
}

// Seguidores de máximo y mínimo con decaimiento lento; el umbral queda al 60 %
// entre ambos. Un latido es un cruce ascendente del umbral con periodo refractario.
void detectarLatido(int adc, unsigned long ahora) {
  if (adc > maximo) maximo = adc;
  if (adc < minimo) minimo = adc;
  if (ahora - ultimoSeguimientoMs >= 20) {       // cada 20 ms los seguidores se acercan
    ultimoSeguimientoMs = ahora;
    if (maximo > minimo + 1) { maximo--; minimo++; }
  }

  int amplitud = maximo - minimo;
  if (amplitud < 60) return;                      // señal demasiado pequeña

  int umbral = minimo + (amplitud * 6) / 10;
  if (adc > umbral && !porEncima) {
    porEncima = true;
    if (ahora - ultimoLatidoMs > 300) {           // refractario de 300 ms (máx. 200 lpm)
      if (ultimoLatidoMs != 0) registrarRR(ahora - ultimoLatidoMs);
      ultimoLatidoMs = ahora;
      digitalWrite(PIN_LED_BEAT, HIGH);
      apagarLedLatidoMs = ahora + 40;
    }
  } else if (adc < umbral) {
    porEncima = false;
  }
}

void registrarRR(unsigned long rrMs) {
  if (rrMs < 273 || rrMs > 2000) return;          // fuera de 30-220 lpm: se descarta
  intervalosRR[idxRR] = rrMs;
  idxRR = (idxRR + 1) % 4;
  if (nRR < 4) nRR++;
  if (nRR >= 3) {
    unsigned long suma = 0;
    for (uint8_t i = 0; i < nRR; i++) suma += intervalosRR[i];
    Serial.print(F("H,"));
    Serial.println(60000UL * nRR / suma);         // BPM = 60 / RR promedio
  }
}

void actualizarLedLatido() {
  if (apagarLedLatidoMs && millis() >= apagarLedLatidoMs) {
    digitalWrite(PIN_LED_BEAT, LOW);
    apagarLedLatidoMs = 0;
  }
}

// ---------- Comandos desde la web ----------
void leerComandos() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      bufferCmd[largoCmd] = '\0';
      if (largoCmd > 0) procesarComando(bufferCmd);
      largoCmd = 0;
    } else if (c != '\r' && largoCmd < sizeof(bufferCmd) - 1) {
      bufferCmd[largoCmd++] = c;
    }
  }
}

void procesarComando(char *linea) {
  char *coma = strchr(linea, ',');
  const char *valor = "";
  if (coma) { *coma = '\0'; valor = coma + 1; }

  if (strcmp(linea, "PING") == 0) {
    Serial.println(F("A,PING,OK,pong"));
  } else if (strcmp(linea, "START") == 0) {
    transmitiendo = true;
    Serial.println(F("A,START,OK,transmitiendo"));
  } else if (strcmp(linea, "STOP") == 0) {
    transmitiendo = false;
    Serial.println(F("A,STOP,OK,en pausa"));
  } else if (strcmp(linea, "LED") == 0) {
    if (strcmp(valor, "0") == 0 || strcmp(valor, "1") == 0) {
      digitalWrite(PIN_LED_WEB, strcmp(valor, "1") == 0 ? HIGH : LOW);
      Serial.print(F("A,LED,OK,"));
      Serial.println(valor);
    } else {
      Serial.println(F("A,LED,ERR,valor 0 o 1"));
    }
  } else if (strcmp(linea, "FS") == 0) {
    unsigned int nuevo = 0;
    if (strcmp(valor, "125") == 0) nuevo = 125;
    else if (strcmp(valor, "250") == 0) nuevo = 250;
    else if (strcmp(valor, "500") == 0) nuevo = 500;

    if (nuevo != 0) {
      fs = nuevo;
      periodoUs = 1000000UL / fs;
      proximaMuestraUs = micros() + periodoUs;
      Serial.print(F("A,FS,OK,"));
      Serial.println(fs);
    } else {
      Serial.println(F("A,FS,ERR,use 125, 250 o 500"));
    }
  } else {
    Serial.print(F("A,"));
    Serial.print(linea);
    Serial.println(F(",ERR,desconocido"));
  }
}
