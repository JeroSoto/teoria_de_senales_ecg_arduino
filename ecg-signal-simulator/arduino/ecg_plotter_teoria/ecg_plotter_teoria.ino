/*
 * ============================================================
 *  ECG en tiempo real: Serial Plotter del Arduino IDE  +  página del proyecto
 *  Arduino Uno / Nano + módulo AD8232                         versión 3.0
 *  Proyecto educativo de Teoría de Señales (Universidad de Manizales)
 *  NO es un dispositivo médico ni sirve para diagnóstico.
 * ============================================================
 *
 *  ESTE SKETCH TIENE DOS MODOS (cambia solo entre ellos)
 *
 *    MODO GRÁFICA (al encender)  -> Serial Plotter / Serial Monitor del Arduino IDE.
 *      Onda filtrada y centrada en 0, con la derivación en la leyenda:  II:123,FC:72,Cero:0
 *
 *    MODO WEB  -> la página del proyecto (npm start o la versión publicada en Vercel).
 *      Al conectarse, la página envía "WEB" y el sketch pasa al protocolo del proyecto
 *      (el mismo que entiende el servidor), a 250 muestras por segundo:
 *        I,ECG_PLOTTER_TEORIA,3.0,fs=250   anuncio
 *        S,<adc>                           muestra (0-1023; la página aplica sus filtros)
 *        H,<bpm>                           frecuencia cardíaca medida aquí (H,0 = sin medición válida)
 *        R,<rr ms>,<QRS en centésimas de mV>,<1 regular | 0 irregular>
 *        D,<derivación>                    derivación que se está midiendo
 *        L,<0|1>                           electrodo suelto (si USAR_LEADS_OFF = true)
 *        A,<CMD>,<OK|ERR>,<info>           respuesta a un comando
 *      Comandos de la página: PING, START, STOP, LED,<0|1>, FS,<125|250|500>,
 *      DER,<derivación>, P (vuelve al modo gráfica).
 *      No tienes que hacer nada: la página lo hace sola.
 *
 *    Un puerto USB lo usa UN programa a la vez: o el Serial Plotter, o la página.
 *    El Arduino IDE puede seguir abierto; cierra el Plotter/Monitor antes de usar la página
 *    (y cierra la página, o pulsa «Liberar puerto», antes de volver a cargar el sketch).
 *
 *  CONEXIONES
 *    AD8232 OUTPUT -> A0
 *    AD8232 LO+    -> D10   (solo si USAR_LEADS_OFF = true)
 *    AD8232 LO-    -> D11   (solo si USAR_LEADS_OFF = true)
 *    AD8232 3.3V   -> 3.3V        AD8232 GND -> GND
 *    LED opcional en D8 (lo controla la página) y en D9 (parpadea con cada latido),
 *    cada uno con una resistencia de 220 ohm a GND.
 *    Los 3 electrodos (RA, LA, RL) deben estar pegados a la piel.
 *    Sin electrodos el módulo solo capta ruido de la red eléctrica: el sketch lo reconoce
 *    y NO muestra una frecuencia cardíaca inventada (FC = 0).
 *
 *  CÓMO SE CALCULA LA FRECUENCIA CARDÍACA (algoritmo de Pan-Tompkins, 1985)
 *    1. Pasa-banda 5-15 Hz: deja la energía del complejo QRS y atenúa las ondas P y T,
 *       la deriva de la línea base, la red de 60 Hz y el ruido muscular.
 *    2. Derivada, elevación al cuadrado e integración en una ventana de 150 ms:
 *       cada QRS se convierte en un pulso.
 *    3. Umbral adaptativo entre el nivel de los QRS y el nivel del ruido.
 *    4. Período refractario de 200 ms y discriminación de la onda T: un pico que aparece
 *       entre 200 y 360 ms después del QRS con menos de la mitad de su PENDIENTE máxima es la
 *       onda T (puede ser alta, pero nunca tan empinada como el QRS).
 *       (La versión anterior la contaba como latido y por eso marcaba ~200 lpm.)
 *    5. Búsqueda hacia atrás: si pasa 1.66 RR sin latido, se recupera el QRS que quedó bajo el umbral.
 *    6. FC = 60 / RR con la MEDIANA de los últimos 8 intervalos RR, y solo si la señal es confiable:
 *         - relación señal/ruido >= 3 (con ECG real es 8-30; sin electrodos, ~2);
 *         - intervalos coherentes (desviación mediana <= 12 % del RR);
 *         - RR entre 300 y 2000 ms (200 a 30 lpm).
 *       Si no se cumple, FC = 0 y el informe de texto dice por qué (ruido, ritmo irregular, sin latidos).
 *
 *  CÓMO VER LA GRÁFICA EN EL ARDUINO IDE
 *    1. Herramientas > Placa: Arduino Uno.
 *    2. Herramientas > Puerto: el de tu Arduino (COM3, COM5...).
 *    3. Cargar (flecha ->).
 *    4. Herramientas > Serial Plotter (Ctrl+Shift+L) y elige 115200 baud en el menú
 *       de abajo a la derecha (el IDE lo recuerda). La página del proyecto también usa 115200.
 *    Tip: activa "Interpolate" en el Plotter para suavizar la línea.
 *    Quédate quieto y relajado: hablar o mover los brazos mete ruido muscular.
 *    La FC aparece después de unos 5 segundos (2 s de calibración + 4 latidos).
 *
 *  QUÉ MUESTRA LA GRÁFICA DEL PLOTTER
 *    <derivación>   la onda ECG centrada en 0 (la leyenda dice cuál es: I, II, V2...)
 *    FC             frecuencia cardíaca en latidos por minuto (0 = todavía no hay medición confiable)
 *    Cero           línea de referencia
 *    SUELTO         aparece en lugar de la derivación si un electrodo se despega
 *    La amplitud de la onda se lee en el eje: unas 225 unidades = 1 mV
 *    (aproximado, depende del módulo y de los electrodos).
 *    El Plotter solo muestra 50 puntos a la vez; por eso aquí se envían 40 por segundo.
 *    La página del proyecto recibe 250 por segundo y dibuja la forma completa.
 *
 *  DERIVACIONES (el AD8232 mide UNA a la vez)
 *    Un ECG de 12 derivaciones usa 10 electrodos. El AD8232 tiene un solo
 *    canal, así que se mide una derivación, se anota, se cambian los
 *    electrodos de lugar y se mide la siguiente.
 *    Para que la leyenda y el resumen digan cuál estás midiendo, escribe el
 *    nombre en "Type Message" del Plotter y pulsa SEND (o elígelo en la página):
 *       I  II  III   (periféricas)      AVR  AVL  AVF  (periféricas aumentadas)
 *       V1 V2 V3 V4 V5 V6               (precordiales)
 *    Es solo una etiqueta: el sketch no sabe dónde pusiste los electrodos.
 *
 *  INFORMES DE TEXTO
 *       M         modo texto: abre el Serial Monitor (misma velocidad) y verás
 *                 un informe por segundo (FC, RR, QRS, ritmo y calidad de la señal).
 *       P         vuelve a la gráfica.
 *       RESUMEN   tabla con la última medición de cada derivación.
 *       AYUDA     lista de comandos.
 *    (Los comandos se escriben en "Type Message" del Plotter o del Monitor.)
 *
 *  CAMBIAR LA VELOCIDAD (300 a 115200 baud) SIN VOLVER A CARGAR EL SKETCH
 *    Experimento de Teoría de Señales: a menos baudios caben menos puntos por segundo.
 *    La velocidad del sketch y la del Plotter DEBEN ser iguales.
 *      1. Escribe la nueva velocidad (300, 600, 1200, 2400, 4800, 9600, 19200,
 *         57600 o 115200) en "Type Message" y pulsa SEND. El LED parpadea 1 a 9
 *         veces (1 = 300 ... 9 = 115200) y la velocidad queda guardada.
 *      2. Elige la MISMA velocidad en el menú del Plotter. Al reabrir el puerto el Uno
 *         se reinicia solo (2 o 3 s sin gráfica) y dibuja con la velocidad nueva.
 *    Escribir 0 vuelve a 115200 (la que usa la página del proyecto).
 *
 *  PRUEBA SIN SENSOR: pon MODO_DEMO = true (ECG sintético de BPM_DEMO lpm, con onda T alta).
 */

#include <EEPROM.h>
#include <ctype.h>
#include <string.h>
#include <math.h>

// ---------- Pines ----------
const uint8_t PIN_ECG        = A0;
const uint8_t PIN_LO_PLUS    = 10;
const uint8_t PIN_LO_MINUS   = 11;
const uint8_t PIN_LED_WEB    = 8;   // LED que se enciende y apaga desde la página (opcional)
const uint8_t PIN_LED_LATIDO = 9;   // parpadea con cada latido detectado (opcional)

// ---------- Configuración (cámbiala aquí) ----------
const bool MODO_DEMO          = false;  // true: ECG sintético, sin sensor
const float BPM_DEMO          = 72.0f;  // frecuencia del ECG sintético
const bool FILTRO_60HZ        = true;   // elimina la interferencia de la red (60 Hz)
const bool USAR_LEADS_OFF     = false;  // true si conectaste LO+ a D10 y LO- a D11
const bool MOSTRAR_LINEA_CERO = true;   // dibuja la línea de referencia en 0 (Plotter)
const bool MOSTRAR_FC_EN_GRAFICA = true;  // dibuja la frecuencia cardíaca en el Plotter
const unsigned int PUNTOS_MAX = 40;     // puntos por segundo en el Plotter; debe dividir a 200
const unsigned int SUAVIZAR_HZ = 40;    // pasa-bajas contra ruido muscular; 0 = sin suavizado
const unsigned long BAUDIOS_INICIAL = 115200;  // velocidad por defecto (y al escribir 0)
const float CUENTAS_POR_MV = 225.0f;    // cuentas del conversor por mV (aprox. para el AD8232 a 5 V)
const unsigned int FS_GRAFICA     = 200;  // muestreo en modo gráfica (Hz)
const unsigned int FS_WEB_INICIAL = 250;  // muestreo en modo web (la página puede pedir 125, 250 o 500)

// ---------- Velocidades ----------
const unsigned long BAUDIOS_VALIDOS[] = {300, 600, 1200, 2400, 4800, 9600, 19200, 57600, 115200};
const uint8_t N_BAUDIOS = sizeof(BAUDIOS_VALIDOS) / sizeof(BAUDIOS_VALIDOS[0]);
const unsigned int DIVISORES[] = {40, 25, 20, 10, 8, 5, 4, 2, 1};   // todos dividen a 200
const uint8_t N_DIVISORES = sizeof(DIVISORES) / sizeof(DIVISORES[0]);
const int     DIR_EEPROM   = 0;          // dirección 0: marca; dirección 1: velocidad elegida
const uint8_t MARCA_EEPROM = 0xED;

// ---------- Derivaciones ----------
const uint8_t N_DERIV = 12;
const char* const NOMBRES[N_DERIV] = {"I", "II", "III", "AVR", "AVL", "AVF", "V1", "V2", "V3", "V4", "V5", "V6"};

// ---------- Constantes internas ----------
static_assert(FS_GRAFICA % PUNTOS_MAX == 0, "PUNTOS_MAX debe dividir a 200 (40, 25, 20, 10, 8, 5, 4, 2, 1)");
// Peso máximo de una línea de texto: "AVR:-1023,FC:240,Cero:0\n"
const unsigned int BYTES_ETIQUETADO = 10 + (MOSTRAR_LINEA_CERO ? 7 : 0);
const unsigned int BYTES_RICO       = BYTES_ETIQUETADO + 7;
const unsigned int BYTES_SIMPLE     = 6;               // "-1023\n"
const unsigned int PUNTOS_MIN_RICO  = 25;              // por debajo de esto no se dibuja la FC
const float RADIO_NOTCH = 0.95f;                       // ancho del notch (más cerca de 1 = más estrecho)
const float TAU_BASE_S  = 1.5f;                        // constante de tiempo de la línea base (s)
const float DOS_PI      = 6.2831853f;

// ---------- Estado: muestreo y filtros de la señal (dependen de fs) ----------
unsigned int  fs = FS_GRAFICA;
unsigned int  fsWeb = FS_WEB_INICIAL;
unsigned long periodoUs = 1000000UL / FS_GRAFICA;
unsigned int  nBase = (unsigned int)(FS_GRAFICA * TAU_BASE_S);  // al inicio la línea base es un promedio acumulado
unsigned int  calentamiento = FS_GRAFICA / 2;                   // 0,5 s sin dibujar mientras se estabiliza
float notchC = 0, notchK = 1, alfaBase = 0, alfaSuave = 1;

// ---------- Estado: puerto serial ----------
enum Formato : uint8_t { SIMPLE, ETIQUETADO, RICO };
unsigned long baudios = BAUDIOS_INICIAL;
Formato       formato = ETIQUETADO;
unsigned int  puntosPorSegundo = PUNTOS_MAX;
unsigned int  muestrasPorPunto = FS_GRAFICA / PUNTOS_MAX;
char    comando[16];                                   // hasta 15 caracteres (p. ej. "DER,AVR", "FS,500")
uint8_t largoComando = 0;
bool    descartarComando = false;

// ---------- Estado: modo web ----------
bool modoWeb = false;
bool transmitiendo = true;
bool sueltoAvisado = false;
unsigned long ultimoAvisoSueltoMs = 0;
unsigned long apagarLedLatidoMs = 0;

// ---------- Estado: señal ----------
unsigned long proximaMuestraUs = 0;
bool  iniciado = false;
float xPrev1 = 0, xPrev2 = 0, yPrev1 = 0, yPrev2 = 0;  // memoria del notch
float lineaBase = 0, suave = 0;
unsigned int muestrasBase = 0;                         // muestras usadas para calcular la línea base
float mejor = 0;                                       // valor de mayor amplitud del tramo actual
unsigned int cuentaTramo = 0, cuentaInicio = 0;
float tDemo = 0;
bool  electrodoSuelto = false;
bool  modoTexto = false;
unsigned int cuentaReporte = 0;
uint8_t derivacion = 0;                                // derivación que se está midiendo (índice en NOMBRES)

// ============================================================
//  DETECTOR DE LATIDOS (Pan-Tompkins)
//  Corre a fsDet = fs (125, 200 o 250 Hz); con fs = 500 promedia pares de muestras
//  y corre a 250 Hz, así los búferes caben en los 2 KB de RAM del Uno.
// ============================================================
const uint8_t MAX_VENTANA  = 38;   // 150 ms a 250 Hz (integración)
const uint8_t MAX_BUSQUEDA = 50;   // 200 ms a 250 Hz (ubicación y pendiente del QRS)
const uint8_t N_RR = 8;            // intervalos RR para la mediana

enum Calidad : uint8_t { CALIBRANDO, BUENA, RUIDO, IRREGULAR, SIN_SENAL };

/** Filtro IIR de 2.º orden (Butterworth, Q = 1/raíz de 2): pasa-altas o pasa-bajas. */
struct Biquad {
  float b0, b1, b2, a1, a2, x1, x2, y1, y2;
  void disenar(float f0, float fsd, bool pasaAltas) {
    const float w0 = DOS_PI * f0 / fsd, c = cosf(w0), alfa = sinf(w0) / (2.0f * 0.70710678f), a0 = 1.0f + alfa;
    if (pasaAltas) { b0 = (1.0f + c) / 2.0f; b1 = -(1.0f + c); }
    else           { b0 = (1.0f - c) / 2.0f; b1 = 1.0f - c; }
    b2 = b0;
    b0 /= a0; b1 /= a0; b2 /= a0;
    a1 = -2.0f * c / a0;
    a2 = (1.0f - alfa) / a0;
    x1 = x2 = y1 = y2 = 0;
  }
  void iniciar(float x) {                     // régimen permanente para una entrada constante (sin transitorio)
    const float g = (b0 + b1 + b2) / (1.0f + a1 + a2);
    x1 = x2 = x; y1 = y2 = g * x;
  }
  float procesar(float x) {
    const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  }
};

// Configuración del detector (se recalcula al cambiar fs)
unsigned int fsDet = FS_GRAFICA, msDet = 5;
uint8_t ventanaLargo = 30, busquedaLargo = 40;
unsigned int refractarioDet, ventanaTDet, calibracionDet;
float decaeNiveles = 1.0f;

// Estado del detector
Biquad pasaAltas5, pasaBajas15;
float mwi[MAX_VENTANA];                 // derivada al cuadrado (ventana de integración)
float pendienteAbs[MAX_BUSQUEDA];       // |derivada del pasa-banda| de los últimos 200 ms
int16_t valorAbs[MAX_BUSQUEDA];         // |señal| de los últimos 200 ms (para medir el QRS en mV)
float mwiSuma = 0;
uint8_t mwiPos = 0;
float h0 = 0, h1 = 0, h2 = 0, h3 = 0;   // pasa-banda en n-1 … n-4 (derivada de 5 puntos)
float int1 = 0, int2 = 0;               // señal integrada en n-1 y n-2
float spk = 0, npk = 0, umbral = 1e30f; // niveles de QRS, de ruido y umbral
float maxCalibracion = 0, sumaCalibracion = 0;
unsigned long nDet = 0;                 // muestras procesadas por el detector
bool iniciadoDet = false;
bool hayQRS = false;
unsigned long ultimoQRS = 0;            // muestra del último pico R aceptado
float ampQRS = 0;                       // pendiente máxima típica de los QRS recientes
unsigned int rrDet[N_RR];               // RR del detector (en muestras), para la búsqueda hacia atrás
uint8_t nRrDet = 0;
float rrPromDet = 0;
bool hayCandidato = false;              // mejor pico bajo el umbral desde el último QRS
float candPico = 0, candAmp = 0;
unsigned long candR = 0;
int16_t candValor = 0;
float acumDecimar = 0;                  // para fs = 500: promedio de pares de muestras
bool mitadDecimar = false;

// Estado de la frecuencia cardíaca
unsigned int rrHist[N_RR];              // últimos RR válidos en ms (orden cronológico)
uint8_t nHist = 0;
bool hayRef = false;
unsigned long refLatido = 0;            // muestra del último latido usado para medir RR
bool hayValido = false;
unsigned long ultimoValido = 0;         // muestra del último cálculo de FC confiable
Calidad calidad = CALIBRANDO;
unsigned int bpmActual = 0, rrActual = 0;   // 0 = sin medición confiable
float ampMedia = 0;                     // amplitud media del QRS en cuentas
bool  ritmoRegular = true;
unsigned int latidosActuales = 0;
// Última medición de cada derivación (para RESUMEN)
unsigned int bpmDeriv[N_DERIV], ampDeriv[N_DERIV], latidosDeriv[N_DERIV];   // amp en centésimas de mV

// ---------- ECG sintético (suma de gaussianas P, Q, R, S, T) ----------
float onda(float f, float amplitud, float centro, float sigma) {
  const float d = (f - centro) / sigma;
  return amplitud * expf(-0.5f * d * d);
}

float ecgDemo(float t) {
  const float fase = fmodf(t * BPM_DEMO / 60.0f, 1.0f);   // 0..1 dentro de cada latido
  return onda(fase, 0.15f, 0.16f, 0.025f)                 // P
       + onda(fase, -0.12f, 0.285f, 0.010f)               // Q
       + onda(fase, 1.00f, 0.300f, 0.010f)                // R
       + onda(fase, -0.22f, 0.318f, 0.012f)               // S
       + onda(fase, 0.60f, 0.560f, 0.045f);               // T alta: comprueba que no se cuente como latido
}

// ---------- Velocidad del puerto serial ----------
uint8_t indiceDeBaudios(unsigned long b) {
  for (uint8_t i = 0; i < N_BAUDIOS; i++) if (BAUDIOS_VALIDOS[i] == b) return i;
  return N_BAUDIOS;                                        // no es una velocidad válida
}

unsigned long velocidadGuardada() {
  if (EEPROM.read(DIR_EEPROM) == MARCA_EEPROM) {
    const uint8_t i = EEPROM.read(DIR_EEPROM + 1);
    if (i < N_BAUDIOS) return BAUDIOS_VALIDOS[i];
  }
  return BAUDIOS_INICIAL;
}

// Calcula qué formato y cuántos puntos por segundo caben en el Plotter (máximo el 80 % del cable).
void configurarVelocidad(unsigned long b) {
  baudios = b;
  const unsigned long presupuesto = b / 10UL * 8UL / 10UL;     // bytes por segundo (10 bits por byte)
  unsigned int bytesLinea;
  if (MOSTRAR_FC_EN_GRAFICA && (unsigned long)BYTES_RICO * PUNTOS_MIN_RICO <= presupuesto) {
    formato = RICO;       bytesLinea = BYTES_RICO;
  } else if ((unsigned long)BYTES_ETIQUETADO * PUNTOS_MAX <= presupuesto) {
    formato = ETIQUETADO; bytesLinea = BYTES_ETIQUETADO;
  } else {
    formato = SIMPLE;     bytesLinea = BYTES_SIMPLE;
  }
  puntosPorSegundo = 1;
  for (uint8_t i = 0; i < N_DIVISORES; i++) {
    if (DIVISORES[i] <= PUNTOS_MAX && (unsigned long)bytesLinea * DIVISORES[i] <= presupuesto) {
      puntosPorSegundo = DIVISORES[i];
      break;
    }
  }
  muestrasPorPunto = FS_GRAFICA / puntosPorSegundo;
}

void parpadear(uint8_t veces) {
  for (uint8_t i = 0; i < veces; i++) {
    digitalWrite(LED_BUILTIN, HIGH); delay(60);
    digitalWrite(LED_BUILTIN, LOW);  delay(60);
  }
}

void cambiarVelocidad(unsigned long nueva) {
  const uint8_t i = indiceDeBaudios(nueva);
  if (i >= N_BAUDIOS || nueva == baudios) return;          // valor no válido o igual al actual
  EEPROM.update(DIR_EEPROM, MARCA_EEPROM);                 // se recuerda aunque el Uno se reinicie
  EEPROM.update(DIR_EEPROM + 1, i);
  Serial.flush();
  Serial.end();
  configurarVelocidad(nueva);
  Serial.begin(baudios);
  cuentaTramo = 0;
  mejor = 0;
  parpadear(i + 1);
  proximaMuestraUs = micros();
}

// ============================================================
//  Detector de latidos y frecuencia cardíaca
// ============================================================

/** Mediana de n valores (para n par, el central superior). */
unsigned int mediana(const unsigned int* v, uint8_t n) {
  unsigned int orden[N_RR];
  for (uint8_t i = 0; i < n; i++) {                        // ordenamiento por inserción (n <= 8)
    unsigned int x = v[i];
    int8_t j = i - 1;
    while (j >= 0 && orden[j] > x) { orden[j + 1] = orden[j]; j--; }
    orden[j + 1] = x;
  }
  return orden[n / 2];
}

void reiniciarFrecuencia() {
  nHist = 0;
  hayRef = false;
  hayValido = false;
  calidad = CALIBRANDO;
  bpmActual = 0;
  rrActual = 0;
  ampMedia = 0;
  ritmoRegular = true;
  latidosActuales = 0;
}

void reiniciarDetector() {
  pasaAltas5.disenar(5.0f, fsDet, true);
  pasaBajas15.disenar(15.0f, fsDet, false);
  for (uint8_t i = 0; i < MAX_VENTANA; i++) mwi[i] = 0;
  for (uint8_t i = 0; i < MAX_BUSQUEDA; i++) { pendienteAbs[i] = 0; valorAbs[i] = 0; }
  mwiSuma = 0; mwiPos = 0;
  h0 = h1 = h2 = h3 = 0;
  int1 = int2 = 0;
  spk = npk = 0; umbral = 1e30f;
  maxCalibracion = sumaCalibracion = 0;
  nDet = 0;
  iniciadoDet = false;
  hayQRS = false; ultimoQRS = 0; ampQRS = 0;
  nRrDet = 0; rrPromDet = 0;
  hayCandidato = false;
  mitadDecimar = false;
}

/** Deja todo listo para medir de nuevo (al cambiar de derivación, de fs o si se suelta un electrodo). */
void reiniciarAnalisis() {
  reiniciarDetector();
  reiniciarFrecuencia();
}

void configurarDetector() {
  fsDet = fs > 250 ? fs / 2 : fs;
  msDet = 1000U / fsDet;                                   // 125 -> 8 ms, 200 -> 5 ms, 250 -> 4 ms
  ventanaLargo  = (uint8_t)(0.15f * fsDet + 0.5f);         // 150 ms
  busquedaLargo = (uint8_t)(0.20f * fsDet + 0.5f);         // 200 ms
  if (ventanaLargo > MAX_VENTANA) ventanaLargo = MAX_VENTANA;
  if (busquedaLargo > MAX_BUSQUEDA) busquedaLargo = MAX_BUSQUEDA;
  refractarioDet = (unsigned int)(0.20f * fsDet + 0.5f);   // 200 ms
  ventanaTDet    = (unsigned int)(0.36f * fsDet + 0.5f);   // 360 ms
  calibracionDet = 2 * fsDet;                              // 2 s
  decaeNiveles   = powf(0.6f, 1.0f / fsDet);               // los niveles bajan 40 % por segundo sin latidos
  reiniciarAnalisis();
}

void cambiarDerivacion(uint8_t i) {
  derivacion = i;
  reiniciarAnalisis();
  if (modoWeb) { Serial.print(F("D,")); Serial.println(NOMBRES[derivacion]); }
}

int8_t buscarDerivacion(const char* nombre) {
  for (uint8_t i = 0; i < N_DERIV; i++) if (strcmp(nombre, NOMBRES[i]) == 0) return i;
  return -1;
}

void enviarLatidoWeb() {
  Serial.print(F("H,"));
  Serial.println(bpmActual);
  Serial.print(F("R,"));
  Serial.print(rrActual);
  Serial.print(',');
  Serial.print((unsigned int)(ampMedia / CUENTAS_POR_MV * 100.0f + 0.5f));
  Serial.print(',');
  Serial.println(ritmoRegular ? 1 : 0);
}

/** Retira la FC mostrada (H,0 en modo web) cuando deja de ser confiable. */
void anularFrecuencia() {
  if (bpmActual == 0) return;
  bpmActual = 0;
  if (modoWeb) Serial.println(F("H,0"));
}

/** Un QRS aceptado por el detector: actualiza niveles y el RR promedio del detector. */
void aceptarQRS(unsigned long r, float pico, float amp, float peso) {
  spk = peso * pico + (1.0f - peso) * spk;
  if (hayQRS) {
    const unsigned long rr = r - ultimoQRS;
    if (nRrDet < N_RR) nRrDet++;
    else for (uint8_t i = 1; i < N_RR; i++) rrDet[i - 1] = rrDet[i];
    rrDet[nRrDet - 1] = rr > 65535UL ? 65535U : (unsigned int)rr;
    unsigned long suma = 0;
    for (uint8_t i = 0; i < nRrDet; i++) suma += rrDet[i];
    rrPromDet = (float)suma / nRrDet;
  }
  ultimoQRS = r;
  hayQRS = true;
  ampQRS = ampQRS > 0 ? 0.7f * ampQRS + 0.3f * amp : amp;
  hayCandidato = false;
  digitalWrite(PIN_LED_LATIDO, HIGH);                      // LED de latido (D9)
  apagarLedLatidoMs = millis() + 40;
}

/** Un latido para la FC: RR, mediana, calidad de la señal y FC. */
void registrarLatido(unsigned long r, int16_t valorMax) {
  if (!hayRef) { hayRef = true; refLatido = r; return; }
  if (r <= refLatido) return;
  const unsigned long rrMs = (r - refLatido) * msDet;
  // Menos de 300 ms (más de 200 lpm) no es un latido real en reposo: suele ser la onda T,
  // un movimiento o ruido. Se descarta y se sigue midiendo desde el último latido válido.
  if (rrMs < 300UL) return;
  refLatido = r;
  if (rrMs > 2000UL) { nHist = 0; return; }                // pausa o pérdida de señal: se empieza de nuevo

  if (nHist < N_RR) nHist++;
  else for (uint8_t i = 1; i < N_RR; i++) rrHist[i - 1] = rrHist[i];
  rrHist[nHist - 1] = (unsigned int)rrMs;
  rrActual = (unsigned int)rrMs;
  if (latidosActuales < 65535) latidosActuales++;
  ampMedia = (ampMedia == 0) ? valorMax : 0.7f * ampMedia + 0.3f * valorMax;
  if (nHist < 4) { calidad = CALIBRANDO; return; }

  // Ritmo coherente: al menos 3 de cada 4 intervalos (6 de 8) a ±15 % de la mediana.
  // Un latido real pasa de sobra; el ruido muscular o de movimiento mete RR al azar y no.
  const unsigned int med = mediana(rrHist, nHist);
  const unsigned int tolerancia = (unsigned int)(0.15f * med);
  uint8_t coherentes = 0;
  unsigned int menor = 65535, mayor = 0;
  for (uint8_t i = 0; i < nHist; i++) {
    const unsigned int desv = rrHist[i] > med ? rrHist[i] - med : med - rrHist[i];
    if (desv <= tolerancia) coherentes++;
    if (rrHist[i] < menor) menor = rrHist[i];
    if (rrHist[i] > mayor) mayor = rrHist[i];
  }
  const bool senalConfiable = spk >= 3.0f * npk;           // relación señal/ruido >= 3

  if (senalConfiable && coherentes * 4 >= nHist * 3) {
    bpmActual = (unsigned int)((60000UL + med / 2) / med);   // FC = 60 / RR (mediana)
    calidad = BUENA;
    hayValido = true;
    ultimoValido = r;
    ritmoRegular = (float)(mayor - menor) <= 0.15f * med;
    bpmDeriv[derivacion] = bpmActual;
    ampDeriv[derivacion] = (unsigned int)(ampMedia / CUENTAS_POR_MV * 100.0f + 0.5f);
    latidosDeriv[derivacion] = latidosActuales;
    if (modoWeb) enviarLatidoWeb();
  } else {
    calidad = senalConfiable ? IRREGULAR : RUIDO;
    // conserva la última FC confiable durante 3 s (un artefacto aislado no la borra)
    if (!hayValido || r - ultimoValido > 3UL * fsDet) anularFrecuencia();
  }
}

/** Una muestra para el detector (a fsDet). x = señal filtrada y centrada en 0 (cuentas). */
void detectarMuestra(float x) {
  if (!iniciadoDet) {
    pasaAltas5.iniciar(x);
    pasaBajas15.iniciar(0);
    iniciadoDet = true;
  }
  // 1) pasa-banda 5-15 Hz
  const float b = pasaBajas15.procesar(pasaAltas5.procesar(x));
  // 2) derivada: y[n] = (2x[n] + x[n-1] - x[n-3] - 2x[n-4]) / 8
  const float d = (2.0f * b + h0 - h2 - 2.0f * h3) / 8.0f;
  h3 = h2; h2 = h1; h1 = h0; h0 = b;
  const uint8_t k = nDet % busquedaLargo;
  pendienteAbs[k] = fabsf(d);
  const float ax = fabsf(x);
  valorAbs[k] = ax > 32767.0f ? 32767 : (int16_t)ax;
  // 3) cuadrado y 4) integración en ventana móvil de 150 ms
  const float cuadrado = d * d;
  mwiSuma += cuadrado - mwi[mwiPos];
  mwi[mwiPos] = cuadrado;
  if (++mwiPos >= ventanaLargo) {
    mwiPos = 0;
    float s = 0;                                           // se recalcula la suma: evita que el redondeo se acumule
    for (uint8_t i = 0; i < ventanaLargo; i++) s += mwi[i];
    mwiSuma = s;
  }
  float integrada = mwiSuma / ventanaLargo;
  if (integrada < 0) integrada = 0;

  // 5) decisión: ¿la señal integrada tuvo un máximo local en la muestra anterior?
  bool latido = false;
  unsigned long rLatido = 0;
  int16_t valorLatido = 0;
  if (nDet >= 2 && int1 > int2 && int1 >= integrada) {
    const float pico = int1;
    if (nDet < calibracionDet) {
      if (pico > maxCalibracion) maxCalibracion = pico;
    } else {
      // el latido se ubica en la pendiente máxima (flanco más empinado del QRS) de los 200 ms previos:
      // da RR casi sin jitter, y esa pendiente es la que distingue el QRS de la onda T
      unsigned long r = nDet - 1;
      float amp = -1;
      int16_t vmax = 0;
      for (uint8_t j = 0; j < busquedaLargo; j++) {
        const uint8_t i = (nDet - j) % busquedaLargo;
        if (pendienteAbs[i] > amp) { amp = pendienteAbs[i]; r = nDet - j; }
        if (valorAbs[i] > vmax) vmax = valorAbs[i];
      }
      const unsigned long dt = !hayQRS ? 0xFFFFFFFFUL : (r > ultimoQRS ? r - ultimoQRS : 0);
      if (pico > umbral) {
        if (dt <= refractarioDet) {
          // mismo complejo QRS (o ruido pegado a él): se ignora
        } else if (dt < ventanaTDet && amp < 0.5f * ampQRS) {
          npk = 0.125f * pico + 0.875f * npk;              // 6) es la onda T, no un latido
        } else {
          aceptarQRS(r, pico, amp, 0.125f);
          latido = true; rLatido = r; valorLatido = vmax;
        }
      } else {
        npk = 0.125f * pico + 0.875f * npk;
        if (dt > ventanaTDet && (!hayCandidato || pico > candPico)) {
          hayCandidato = true; candPico = pico; candAmp = amp; candR = r; candValor = vmax;
        }
      }
      umbral = npk + 0.25f * (spk - npk);
    }
  }

  if (nDet < calibracionDet) sumaCalibracion += integrada;
  if (nDet == calibracionDet) {
    // señal = mitad del máximo; ruido = mitad del promedio de la integrada (con solo ruido se parecen)
    spk = 0.5f * maxCalibracion;
    npk = 0.5f * (sumaCalibracion / calibracionDet);
    if (npk < 0.05f * maxCalibracion) npk = 0.05f * maxCalibracion;
    umbral = npk + 0.25f * (spk - npk);
  }
  if (nDet > calibracionDet) {
    const unsigned long sinLatido = hayQRS ? nDet - ultimoQRS : 0xFFFFFFFFUL;
    // 7) búsqueda hacia atrás: pasó 1.66 RR sin latido → se acepta el mejor pico bajo el umbral
    if (!latido && rrPromDet > 0 && hayCandidato && (float)sinLatido > 1.66f * rrPromDet && candPico > 0.5f * umbral) {
      aceptarQRS(candR, candPico, candAmp, 0.25f);
      latido = true; rLatido = candR; valorLatido = candValor;
      umbral = npk + 0.25f * (spk - npk);
    }
    // más de 2 s sin latidos (la amplitud bajó): los niveles se reajustan
    if (sinLatido > 2UL * fsDet) {
      spk *= decaeNiveles;
      npk *= decaeNiveles;
      umbral = npk + 0.25f * (spk - npk);
    }
  }

  int2 = int1;
  int1 = integrada;
  nDet++;

  if (latido) registrarLatido(rLatido, valorLatido);
  // 3 s sin latidos: no hay señal cardíaca (electrodos sueltos o sin contacto)
  if (hayRef && nDet - refLatido > 3UL * fsDet && calidad != SIN_SENAL) {
    nHist = 0;
    calidad = SIN_SENAL;
    anularFrecuencia();
  }
}

/** Entrega cada muestra al detector; con fs = 500 promedia pares (el detector corre a 250 Hz). */
void alimentarDetector(float valor) {
  if (fs > 250) {
    if (!mitadDecimar) { acumDecimar = valor; mitadDecimar = true; return; }
    valor = 0.5f * (acumDecimar + valor);
    mitadDecimar = false;
  }
  detectarMuestra(valor);
}

void actualizarLedLatido() {
  if (apagarLedLatidoMs && (long)(millis() - apagarLedLatidoMs) >= 0) {
    digitalWrite(PIN_LED_LATIDO, LOW);
    apagarLedLatidoMs = 0;
  }
}

// ---------- Frecuencia de muestreo: recalcula filtros y tiempos ----------
void configurarMuestreo(unsigned int nuevaFs) {
  fs = nuevaFs;
  periodoUs = 1000000UL / fs;
  // Notch de 60 Hz con ganancia 1 en continua
  notchC = cosf(DOS_PI * 60.0f / fs);
  notchK = (1.0f - 2.0f * RADIO_NOTCH * notchC + RADIO_NOTCH * RADIO_NOTCH) / (2.0f - 2.0f * notchC);
  alfaBase = 1.0f - expf(-1.0f / (fs * TAU_BASE_S));
  alfaSuave = (SUAVIZAR_HZ > 0) ? 1.0f - expf(-DOS_PI * SUAVIZAR_HZ / fs) : 1.0f;
  nBase = (unsigned int)(fs * TAU_BASE_S);
  calentamiento = fs / 2;
  iniciado = false;
  cuentaInicio = 0;
  cuentaTramo = 0;
  mejor = 0;
  configurarDetector();
  proximaMuestraUs = micros();
}

// ---------- Modo web (página del proyecto) ----------
void anunciarWeb() {
  Serial.print(F("I,ECG_PLOTTER_TEORIA,3.0,fs="));
  Serial.println(fs);
  Serial.print(F("D,"));
  Serial.println(NOMBRES[derivacion]);
  sueltoAvisado = !electrodoSuelto;                        // fuerza a informar el estado de los electrodos
}

void entrarModoWeb() {
  modoWeb = true;
  modoTexto = false;
  transmitiendo = true;
  configurarMuestreo(fsWeb);
  Serial.print(F("A,WEB,OK,"));
  Serial.println(fs);
  anunciarWeb();
}

void entrarModoGrafica() {
  modoWeb = false;
  configurarMuestreo(FS_GRAFICA);
}

void salidaWeb(float x) {
  const unsigned long ahora = millis();
  if (USAR_LEADS_OFF && (electrodoSuelto != sueltoAvisado || (electrodoSuelto && ahora - ultimoAvisoSueltoMs > 2000))) {
    sueltoAvisado = electrodoSuelto;
    ultimoAvisoSueltoMs = ahora;
    Serial.print(F("L,"));
    Serial.println(electrodoSuelto ? 1 : 0);
  }
  if (!transmitiendo || electrodoSuelto) return;
  Serial.print(F("S,"));
  Serial.println((int)(x + 0.5f));                          // muestra cruda: la página aplica sus filtros
}

// ---------- Informes de texto (Serial Monitor) ----------
const __FlashStringHelper* categoriaFC(unsigned int bpm) {
  if (bpm < 60) return F("baja, bradicardia");
  if (bpm <= 100) return F("normal");
  return F("alta, taquicardia");
}

void imprimirReporte() {
  Serial.print('['); Serial.print(NOMBRES[derivacion]); Serial.print(F("] "));
  if (electrodoSuelto) { Serial.println(F("electrodo suelto: revisa que los 3 electrodos esten pegados")); return; }
  if (bpmActual == 0) {
    switch (calidad) {
      case SIN_SENAL: Serial.println(F("no se detectan latidos: revisa que los 3 electrodos esten bien pegados")); break;
      case RUIDO:     Serial.println(F("senal con mucho ruido: quedate quieto, no hables y revisa los electrodos")); break;
      case IRREGULAR: Serial.println(F("latidos irregulares o artefactos: quedate quieto unos segundos")); break;
      default:        Serial.println(F("midiendo... quedate quieto y espera unos 5 segundos")); break;
    }
    return;
  }
  Serial.print(F("FC ")); Serial.print(bpmActual); Serial.print(F(" lpm ("));
  Serial.print(categoriaFC(bpmActual));
  Serial.print(F(") | RR ")); Serial.print(rrActual);
  Serial.print(F(" ms | QRS ")); Serial.print(ampMedia / CUENTAS_POR_MV, 2);
  Serial.print(F(" mV | ritmo ")); Serial.print(ritmoRegular ? F("regular") : F("irregular"));
  Serial.print(F(" | latidos ")); Serial.print(latidosActuales);
  Serial.println(calidad == BUENA ? F("") : F(" | (senal inestable)"));
}

void imprimirResumen() {
  Serial.println(F("--- RESUMEN: ultima medicion de cada derivacion ---"));
  Serial.println(F("Deriv  FC(lpm)  QRS(mV)  Latidos"));
  for (uint8_t i = 0; i < N_DERIV; i++) {
    Serial.print(NOMBRES[i]); Serial.print(F("\t"));
    if (latidosDeriv[i] == 0) { Serial.println(F("sin medir")); continue; }
    Serial.print(bpmDeriv[i]); Serial.print(F("\t"));
    Serial.print(ampDeriv[i] / 100.0f, 2); Serial.print(F("\t"));
    Serial.println(latidosDeriv[i]);
  }
  Serial.println(F("(medicion aproximada, solo educativa)"));
}

void imprimirAyuda() {
  Serial.println(F("--- COMANDOS (escribelos y pulsa SEND/Enter) ---"));
  Serial.println(F("I II III AVR AVL AVF V1..V6  derivacion que estas midiendo"));
  Serial.println(F("M       modo texto (Serial Monitor)"));
  Serial.println(F("P       vuelve a la grafica"));
  Serial.println(F("RESUMEN tabla de todas las derivaciones"));
  Serial.println(F("300 ... 115200  velocidad (baud); 0 = 115200"));
  Serial.println(F("WEB     modo de la pagina del proyecto (la pagina lo envia sola)"));
}

// ---------- Comandos de la página (modo web) ----------
void ejecutarComandoWeb(const char* cmd, const char* valor) {
  if (strcmp(cmd, "PING") == 0) {
    Serial.println(F("A,PING,OK,pong"));
  } else if (strcmp(cmd, "START") == 0) {
    transmitiendo = true;
    Serial.println(F("A,START,OK,transmitiendo"));
  } else if (strcmp(cmd, "STOP") == 0) {
    transmitiendo = false;
    Serial.println(F("A,STOP,OK,en pausa"));
  } else if (strcmp(cmd, "LED") == 0) {
    if (strcmp(valor, "0") == 0 || strcmp(valor, "1") == 0) {
      digitalWrite(PIN_LED_WEB, valor[0] == '1' ? HIGH : LOW);
      Serial.print(F("A,LED,OK,"));
      Serial.println(valor);
    } else {
      Serial.println(F("A,LED,ERR,valor 0 o 1"));
    }
  } else if (strcmp(cmd, "FS") == 0) {
    const unsigned int nueva = (strcmp(valor, "125") == 0) ? 125 : (strcmp(valor, "250") == 0) ? 250 : (strcmp(valor, "500") == 0) ? 500 : 0;
    if (nueva) {
      fsWeb = nueva;
      configurarMuestreo(nueva);
      Serial.print(F("A,FS,OK,"));
      Serial.println(fs);
    } else {
      Serial.println(F("A,FS,ERR,use 125, 250 o 500"));
    }
  } else if (strcmp(cmd, "DER") == 0) {
    const int8_t i = buscarDerivacion(valor);
    if (i >= 0) {
      Serial.print(F("A,DER,OK,"));
      Serial.println(NOMBRES[i]);
      cambiarDerivacion((uint8_t)i);
    } else {
      Serial.println(F("A,DER,ERR,use I II III AVR AVL AVF V1-V6"));
    }
  } else if (strcmp(cmd, "P") == 0) {
    Serial.println(F("A,P,OK,grafica"));
    entrarModoGrafica();
  } else if (buscarDerivacion(cmd) >= 0) {                 // nombre suelto escrito en el Monitor
    cambiarDerivacion((uint8_t)buscarDerivacion(cmd));
  } else {
    Serial.print(F("A,"));
    Serial.print(cmd);
    Serial.println(F(",ERR,desconocido"));
  }
}

// ---------- Comandos escritos en el Plotter, el Monitor o la página ----------
void ejecutarComando() {
  char* valor = strchr(comando, ',');
  if (valor) { *valor = 0; valor++; } else { valor = comando + strlen(comando); }

  if (strcmp(comando, "WEB") == 0) { entrarModoWeb(); return; }   // la página se conectó
  if (modoWeb) { ejecutarComandoWeb(comando, valor); return; }

  bool soloDigitos = comando[0] != 0;
  for (uint8_t i = 0; comando[i]; i++) if (!isdigit((unsigned char)comando[i])) soloDigitos = false;

  if (soloDigitos) {                                       // velocidad
    if (strlen(comando) > 6) return;
    unsigned long v = 0;
    for (uint8_t i = 0; comando[i]; i++) v = v * 10 + (comando[i] - '0');
    if (v == 0) v = BAUDIOS_INICIAL;                       // "0" = valor por defecto
    cambiarVelocidad(v);
    return;
  }
  const int8_t d = buscarDerivacion(comando);              // derivación
  if (d >= 0) { cambiarDerivacion((uint8_t)d); return; }
  if (strcmp(comando, "M") == 0)            { modoTexto = true; cuentaReporte = 0; }
  else if (strcmp(comando, "P") == 0)       { modoTexto = false; }
  else if (strcmp(comando, "RESUMEN") == 0) { modoTexto = true; cuentaReporte = 0; imprimirResumen(); }
  else if (strcmp(comando, "AYUDA") == 0)   { modoTexto = true; cuentaReporte = 0; imprimirAyuda(); }
}

// Se aceptan letras, dígitos y comas (hasta 15); cualquier otra cosa descarta toda la línea.
void leerComandos() {
  while (Serial.available() > 0) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (!descartarComando && largoComando > 0) {
        comando[largoComando] = 0;
        ejecutarComando();
      }
      largoComando = 0;
      descartarComando = false;
    } else if (c == ' ') {
      // los espacios se ignoran
    } else if ((isalnum((unsigned char)c) || c == ',') && largoComando < sizeof(comando) - 1) {
      comando[largoComando++] = (char)toupper((unsigned char)c);
    } else {
      descartarComando = true;                              // símbolos o texto demasiado largo
    }
  }
}

void setup() {
  configurarVelocidad(velocidadGuardada());
  Serial.begin(baudios);
  while (!Serial && millis() < 2000) { }        // solo importa en placas con USB nativo
  if (USAR_LEADS_OFF) {
    pinMode(PIN_LO_PLUS, INPUT);
    pinMode(PIN_LO_MINUS, INPUT);
  }
  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(PIN_LED_WEB, OUTPUT);
  pinMode(PIN_LED_LATIDO, OUTPUT);
  digitalWrite(PIN_LED_WEB, LOW);
  digitalWrite(PIN_LED_LATIDO, LOW);
  parpadear(indiceDeBaudios(baudios) + 1);      // 1 parpadeo = 300 baud ... 9 = 115200

  configurarMuestreo(FS_GRAFICA);               // arranca en modo gráfica (Serial Plotter)
}

void loop() {
  leerComandos();
  actualizarLedLatido();

  const unsigned long ahora = micros();
  if ((long)(ahora - proximaMuestraUs) < 0) return;   // aún no toca la siguiente muestra

  proximaMuestraUs += periodoUs;                      // muestreo a intervalos exactos
  if ((long)(ahora - proximaMuestraUs) > (long)periodoUs) {
    proximaMuestraUs = ahora + periodoUs;             // si nos atrasamos, re-sincroniza
  }

  // 1) Lectura (4 lecturas promediadas, o ECG sintético en modo demo)
  float x;
  if (MODO_DEMO) {
    x = 512.0f + 300.0f * ecgDemo(tDemo);
    tDemo += 1.0f / fs;
  } else {
    long suma = 0;
    for (uint8_t i = 0; i < 4; i++) suma += analogRead(PIN_ECG);
    x = suma / 4.0f;                                  // 0 – 1023
  }

  // 2) Filtro notch de 60 Hz
  if (!iniciado) {                                    // primera muestra: evita el salto inicial
    xPrev1 = xPrev2 = yPrev1 = yPrev2 = x;
    lineaBase = suave = x;
    muestrasBase = 0;
    iniciado = true;
  }
  float y = x;
  if (FILTRO_60HZ) {
    y = notchK * (x - 2.0f * notchC * xPrev1 + xPrev2)
        + 2.0f * RADIO_NOTCH * notchC * yPrev1 - RADIO_NOTCH * RADIO_NOTCH * yPrev2;
    xPrev2 = xPrev1;  xPrev1 = x;
    yPrev2 = yPrev1;  yPrev1 = y;
  }

  // 3) Suavizado (pasa-bajas de 1.er orden) contra el ruido muscular
  if (SUAVIZAR_HZ > 0) {
    suave += alfaSuave * (y - suave);
    y = suave;
  }

  // 4) Quitar la componente continua: la onda queda centrada en 0.
  //    Los primeros 0,1 s el notch aún se estabiliza; después la línea base es el promedio de
  //    todo lo medido (así el arranque no deja la onda desplazada) y luego un promedio móvil.
  if (cuentaInicio < fs / 10) {
    lineaBase = y;
  } else {
    const float alfa = (muestrasBase < nBase) ? 1.0f / (muestrasBase + 1) : alfaBase;
    if (muestrasBase < nBase) muestrasBase++;
    lineaBase += alfa * (y - lineaBase);
  }
  float valor = y - lineaBase;

  // 5) Electrodo suelto: línea en 0 y LED del Arduino encendido
  electrodoSuelto = false;
  if (USAR_LEADS_OFF) {
    electrodoSuelto = digitalRead(PIN_LO_PLUS) == HIGH || digitalRead(PIN_LO_MINUS) == HIGH;
    if (electrodoSuelto) valor = 0;
    digitalWrite(LED_BUILTIN, electrodoSuelto ? HIGH : LOW);
  }

  // 6) Detección de latidos y frecuencia cardíaca
  if (cuentaInicio < calentamiento) { cuentaInicio++; valor = 0; }
  else if (electrodoSuelto) { reiniciarAnalisis(); }
  else { alimentarDetector(valor); }

  // Modo web: protocolo del proyecto, una línea por muestra
  if (modoWeb) { salidaWeb(x); return; }

  // Modo texto: un informe por segundo en lugar de la gráfica
  if (modoTexto) {
    if (++cuentaReporte >= fs) { cuentaReporte = 0; imprimirReporte(); }
    return;
  }

  // 7) Reducir a "puntosPorSegundo" conservando el valor de mayor amplitud de cada tramo
  if (fabsf(valor) > fabsf(mejor)) mejor = valor;
  if (++cuentaTramo < muestrasPorPunto) return;
  const int punto = (int)(mejor >= 0 ? mejor + 0.5f : mejor - 0.5f);
  cuentaTramo = 0;
  mejor = 0;

  // 8) Línea para el Serial Plotter
  if (formato == SIMPLE) {                             // 123
    Serial.print(punto);
  } else {                                             // II:123,FC:72,Cero:0
    Serial.print(electrodoSuelto ? "SUELTO" : NOMBRES[derivacion]);
    Serial.print(':');
    Serial.print(punto);
    if (formato == RICO) { Serial.print(F(",FC:")); Serial.print(bpmActual); }
    if (MOSTRAR_LINEA_CERO) Serial.print(F(",Cero:0"));
  }
  Serial.print('\n');
}
