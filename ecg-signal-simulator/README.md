# Simulación en Tiempo Real de ECG & Análisis Frecuencial (FFT)

**Asignatura:** Teoría de Señales  
**Institución:** Universidad de Manizales  
**Autores:** Jerónimo Soto Villada & Milady Cristina Guapacha Montoya  
**Licencia:** MIT  

---

## 1. Descripción del Proyecto
Este proyecto es una plataforma interactiva web y de análisis de señales desarrollada con **Node.js**, **HTML5 Canvas**, **JavaScript Vanilla** y **Python (SciPy/NumPy)**. Permite simular en tiempo real una señal de electrocardiograma (ECG) y, opcionalmente, mostrar la señal adquirida por un Arduino con módulo AD8232; también permite estudiar perturbaciones como ruido gaussiano, interferencia de red eléctrica (60 Hz) y deriva de línea base (<0.5 Hz).

Además de la simulación interactiva en el navegador, el repositorio incluye un script en Python (`scripts/analisis_fft.py`) que calcula la **Transformada Rápida de Fourier (FFT)** de la señal y genera gráficas estáticas explicativas en la carpeta `results/`.

> **Aviso de Carácter Educativo:** Este proyecto es un desarrollo computacional con fines estrictamente pedagógicos para la asignatura de Teoría de Señales. No constituye una herramienta de diagnóstico clínico ni reemplaza equipos médicos certificados.

---

## 2. Requisitos e Instalación

### Requisitos Previos
* **Node.js** (v18.0.0 o superior)
* **Python 3** (con `numpy`, `scipy` y `matplotlib` para el análisis espectral)
* **Visual Studio Code** (recomendado)
* **XAMPP** (solo el módulo **MySQL**) para el sistema de usuarios y el historial
* **Arduino IDE** y un Arduino Uno/Nano con módulo **AD8232** *(opcional: sin hardware se usa el Arduino simulado)*

### Instrucciones de Ejecución

1. **Desde la raíz del repositorio, instalar dependencias, configurar e iniciar el servidor web:**
   ```bash
   npm --prefix ./ecg-signal-simulator install
   cp ./ecg-signal-simulator/.env.example ./ecg-signal-simulator/.env
   # En Windows PowerShell:
   # Copy-Item .\ecg-signal-simulator\.env.example .\ecg-signal-simulator\.env
   # Abre XAMPP y pulsa "Start" en MySQL, luego:
   npm start
   ```
   Al iniciar, el servidor abre automáticamente `http://localhost:3000` (o el `PORT` de tu `.env`) en el navegador predeterminado y muestra en la terminal la dirección para abrir la página **desde un celular conectado al mismo Wi-Fi**. La simulación y los filtros funcionan sin iniciar sesión; el Arduino por el servidor y el historial requieren una cuenta (ver sección 5). Si MySQL está apagado, el servidor arranca igual en «modo web» (simulador + Arduino por USB desde el navegador). Si abres `src/public/index.html` con Live Server, o en la versión publicada en Vercel (sección 6), funcionan el simulador, los filtros y la **conexión USB directa con el Arduino** (Chrome o Edge), sin sesión ni historial.

2. **Ejecutar el script de Análisis de Frecuencia (FFT) y Filtrado Digital** (desde la carpeta `ecg-signal-simulator`):
   ```bash
   pip install -r ../requirements.txt
   python3 scripts/analisis_fft.py
   ```
   o mediante el script de npm:
   ```bash
   npm run analyze
   ```
   Esto generará las gráficas comparativas en el dominio del tiempo y de la frecuencia en la carpeta `results/`.

---

## 3. Fundamentos Teóricos de Señales Aplicados

### 3.1. Muestreo y Teorema de Nyquist-Shannon
Para evitar el fenómeno de *aliasing* (traslape espectral), la frecuencia de muestreo $f_s$ debe cumplir:
$$f_s \ge 2 \cdot f_{\text{máx}}$$
El contenido espectral clínico relevante del ECG se ubica entre 0.5 Hz y 100-150 Hz. El simulador y los scripts trabajan a $f_s = 250\text{ Hz}$ ($T_s = 4\text{ ms}$), cumpliendo holgadamente el criterio de Nyquist.

### 3.2. Relación entre Frecuencia Cardíaca (BPM) y Frecuencia Fundamental ($f$)
La relación matemática entre las pulsaciones por minuto (BPM) y la frecuencia fundamental del corazón en Hertz (Hz) es:
$$f (\text{Hz}) = \frac{\text{BPM}}{60}, \quad T_{\text{latido}} (s) = \frac{60}{\text{BPM}}$$
Para una frecuencia cardíaca estándar de $75\text{ BPM}$, la frecuencia fundamental es $f = 1.25\text{ Hz}$ ($T = 0.8\text{ s}$).

### 3.3. Análisis Frecuencial mediante FFT
La Transformada Discreta de Fourier (DFT) transforma la señal del dominio del tiempo $x[n]$ al dominio frecuencial $X[k]$:
$$X[k] = \sum_{n=0}^{N-1} x[n] \cdot e^{-j 2\pi \frac{k n}{N}}$$
En el espectro de magnitud $|X[k]|$ (ver `results/README_resultados.md`) se identifican:
* **Líneas a múltiplos de $1.25\text{ Hz}$** ($= \text{BPM}/60$): la fundamental (1.25 Hz) y sus armónicos (2.5, 3.75, 5.0 Hz…). El ECG es periódico pero *no sinusoidal*, por eso la energía se reparte en muchos armónicos y las líneas más altas no son la fundamental sino las de 3.75 y 5.0 Hz (la fundamental es de ≈ 0.05 mV y esas, de ≈ 0.08 mV).
* **Línea en $60\text{ Hz}$:** interferencia capacitiva de la red eléctrica.
* **Máximo cerca de $0\text{ Hz}$:** deriva de la línea base respiratoria ($< 0.5\text{ Hz}$); no es el latido.

---

## 4. Estructura del Repositorio
* `src/server.js`: arranque local (`npm start`): servidor web + API + Arduino por el servidor.
* `src/app.js`: la aplicación Express (rutas, sesión, base de datos). La usan `npm start` y la función de Vercel `api/index.js` (raíz del repositorio).
* `src/config/`: variables de entorno (`env.js`) y conexión Sequelize/MySQL (`database.js`).
* `src/models/`: modelos Sequelize `Usuario`, `Medicion` y `ComandoLog`.
* `src/routes/`: rutas `auth`, `arduino`, `mediciones` y `admin`.
* `src/services/`: puente con el Arduino (`arduinoBridge.js`), transporte serial real y Arduino simulado.
* `src/public/`: Aplicación frontend en HTML5 Canvas, CSS3 y JS Vanilla, con interfaz «glass» adaptada a celulares. `signalProcessing.js` contiene los filtros y el detector Pan-Tompkins; `ecgGenerator.js`, el modelo sintético; `renderer.js`, el monitor (nítido en pantallas de alta densidad); `arduinoLink.js`, el Arduino a través del servidor; `usbSerial.js`, el Arduino por USB directo desde el navegador (Web Serial).
* `arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino`: sketch para Arduino Uno/Nano + AD8232. Sirve para el Serial Plotter del Arduino IDE **y** para la página (ver `arduino/README.md`).
* `database/schema.sql`: esquema para importar desde phpMyAdmin.
* `tests/`: pruebas automáticas (`npm test`): `detector.test.js` (DSP del navegador), `bridge.test.js` y `api.test.js`.
* `.env.example`: plantilla de configuración.
* `scripts/analisis_fft.py`: Script de Python para caracterización, FFT y filtros SciPy (dependencias en `../requirements.txt`).
* `data/muestra_ecg_sintetico.json`: 2 s de ECG limpio (500 muestras a 250 Hz) generados por el mismo script.
* `results/`: Gráficas y tablas generadas (`ecg_time_and_fft.png`, `ecg_filtering_analysis.png`, `caracterizacion.md`) con su interpretación en `README_resultados.md`.
* `docs/teoria_senales.md`: Apuntes teóricos detallados de la asignatura.

---

## 5. Versión 2.0: Arduino, MySQL y usuarios

> **Suposición documentada:** el proyecto usa una simulación educativa y permite capturar señal real con un Arduino Uno/Nano y módulo ECG AD8232 conectado por USB (comunicación serial a 115200 baudios).
>
> **Dos formas de conectar el Arduino:** (1) **por el servidor** (`npm start`): el servidor lee el puerto y reparte la señal a todos los navegadores, incluidos celulares en el mismo Wi-Fi; (2) **por USB directo desde el navegador** (Chrome/Edge, botón «Conectar Arduino»): no necesita servidor y funciona en la página publicada en Vercel. Solo un programa puede usar el puerto a la vez.

### 5.1. Arquitectura

```
 AD8232 ──► Arduino ──USB serial──► Node.js (Express) ──SSE──► index.html (Canvas)
                ▲                        │  ▲                        │
                └────── comandos ◄───────┘  └── REST + cookie JWT ◄───┘
                                         │
                                  Sequelize ──► MySQL (XAMPP)
```

| Capa | Tecnología | Función |
|------|-----------|---------|
| Backend | Node.js + Express | Sirve la web, API REST y flujo en tiempo real |
| Base de datos | MySQL (XAMPP) | Usuarios, historial de BPM y auditoría de comandos |
| ORM | Sequelize | Modelos, relaciones y consultas preparadas |
| Tiempo real | Server-Sent Events | El servidor empuja muestras, BPM y estado a todos los navegadores |
| Serial | `serialport` | Lectura/escritura del Arduino por USB |

**Sincronización:** el estado del Arduino (LED, muestreo, conexión) vive en el servidor y se transmite a todas las pestañas y usuarios conectados, de modo que todos ven lo mismo.

### 5.2. Puesta en marcha paso a paso

1. **XAMPP:** instala XAMPP, abre el *Control Panel* y pulsa **Start** en **MySQL** (no hace falta Apache). Por defecto el usuario es `root` sin contraseña.
2. **Configuración:** copia `.env.example` a `.env`. Con XAMPP por defecto no necesitas cambiar la sección de base de datos. Cambia `JWT_SECRET` por una cadena aleatoria:
   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```
3. **Base de datos** (elige una):
   * **Automática (recomendada):** al ejecutar `npm start`, Sequelize crea la base `arduino_ecg` y las tablas.
   * **Manual:** en `http://localhost/phpmyadmin` → *Importar* → `database/schema.sql`, y pon `DB_SYNC=false` en `.env`.
4. **Validar Sequelize:** `npm run db:check` debe mostrar ✔ para las tres tablas.
5. **Arduino (opcional):**
   1. Arma el circuito de `arduino/README.md`.
   2. Abre `arduino/ecg_plotter_teoria/ecg_plotter_teoria.ino` en el Arduino IDE y súbelo a la placa (Uno/Nano). Para verificar, abre el Serial Plotter a **115200** baudios: verás la onda con la derivación en la leyenda.
   3. Deja `ARDUINO_MODE=serial` y `ARDUINO_PORT=auto` en `.env` (valores por defecto): el servidor encuentra la placa solo e ignora los puertos Bluetooth virtuales (COM3/COM4). `npm run puertos` muestra cuál eligió.
   4. **Cierra el Serial Plotter / Monitor Serie** (el Arduino IDE puede seguir abierto): en Windows solo un programa puede usar el puerto. Si está ocupado, la página lo dice y el servidor reintenta cada 3 s hasta que lo cierres.
6. **Iniciar:** `npm start` y abre `http://localhost:3000`.
7. **Crear cuenta:** botón **Crear cuenta** (el primer usuario queda como administrador). También por terminal:
   ```bash
   npm run usuario -- "Nombre Apellido" correo@ejemplo.com Clave1234 admin
   ```
8. **Usar el Arduino:** inicia sesión → el monitor cambia solo a la señal del Arduino en cuanto se conecta (o pulsa **Usar señal del Arduino**). El servidor envía `WEB` al sketch y este pasa del formato del Plotter al protocolo completo a 250 Hz. Para **subir un sketch nuevo sin cerrar `npm start`**, pulsa **Liberar puerto**, carga desde el IDE y luego **Reconectar**. Sin hardware, `ARDUINO_MODE=simulate` emula un Arduino con el mismo protocolo.

### 5.3. Protocolo serial

Líneas de texto terminadas en `\n`.

| Dirección | Mensaje | Significado |
|-----------|---------|-------------|
| Arduino → PC | `II:123,FC:72,Cero:0` | Modo gráfica (Serial Plotter, 40 puntos/s): onda filtrada, FC y línea de cero |
| PC → Arduino | `WEB` | Pide el protocolo completo (lo envían el servidor y la página solos) |
| Arduino → PC | `I,ECG_PLOTTER_TEORIA,2.0,fs=250` | Anuncio del modo web |
| Arduino → PC | `S,<adc>` | Muestra del ECG (0–1023) a `fs` Hz |
| Arduino → PC | `H,<bpm>` | Frecuencia cardíaca calculada a bordo (`H,0` = ya no hay una medición confiable) |
| Arduino → PC | `R,<rr ms>,<QRS cmV>,<1\|0>` | Intervalo RR, amplitud del QRS (centésimas de mV) y ritmo regular/irregular |
| Arduino → PC | `D,<derivación>` | Derivación que se está midiendo (I, II, III, AVR, AVL, AVF, V1–V6) |
| Arduino → PC | `L,<0\|1>` | 1 = electrodo suelto |
| Arduino → PC | `A,<CMD>,<OK\|ERR>[,info]` | Confirmación de comando |
| PC → Arduino | `PING`, `START`, `STOP`, `LED,<0\|1>`, `FS,<125\|250\|500>`, `DER,<derivación>`, `P` | Comandos permitidos (lista cerrada; `P` vuelve al modo gráfica) |

Si el sketch no entiende `WEB` (por ejemplo, una versión anterior), la página sigue funcionando con el formato del Plotter; y si no llega nada legible en 5 s, prueba 115200 y 9600 baudios.

**Conversión a mV:** el servidor resta la componente continua con un promedio móvil exponencial (τ ≈ 1,5 s, equivale a un pasa-altas muy suave) y divide por `ARDUINO_COUNTS_PER_MV` (≈ 225 para AD8232 con referencia de 5 V). Ajusta ese valor si la señal se ve muy grande o pequeña.

### 5.3.1. Cómo se calcula la frecuencia cardíaca (página y sketch, v3)

El mismo algoritmo corre en el navegador (`signalProcessing.js`) y en el Arduino (`ecg_plotter_teoria.ino`):

1. **Pan-Tompkins:** notch de 60 Hz → pasa-banda 5–15 Hz → derivada → cuadrado → integración de 150 ms → umbral adaptativo entre el nivel de los QRS (SPK) y el del ruido (NPK).
2. **Período refractario de 200 ms** y **discriminación de la onda T:** un pico entre 200 y 360 ms después del QRS con menos de la mitad de su *pendiente* máxima es la onda T. La T puede ser tan alta como el QRS, pero nunca tan empinada; contarla como latido era lo que duplicaba el BPM (~200 lpm).
3. **Búsqueda hacia atrás:** si pasa 1,66 RR sin latido, se recupera el QRS que quedó bajo el umbral.
4. **BPM = 60 / RR** con la **mediana de los últimos 8 intervalos RR** (300–2000 ms), y solo si la señal es confiable:
   * relación señal/ruido SPK/NPK ≥ 3 (con un ECG real es de 8 a 30; sin electrodos ronda 2);
   * al menos 6 de 8 intervalos a ±15 % de la mediana (el ruido muscular mete intervalos al azar);
   * no más de 1 de las últimas 8 detecciones a menos de 300 ms: si hay más, es una interferencia periódica (p. ej. picos cada 0,26 s ≈ 230/min). Sin esta regla se descartaba uno de cada dos picos y salía un ritmo «regular» falso de ~115 lpm.
5. Si no se cumple, se muestra «--» con el motivo (ruido, latidos irregulares o sin latidos); el último valor confiable se conserva 3 s.
6. **Diagnóstico de contacto:** la página mide qué parte de la potencia es la red de 60 Hz (señal comparada con la misma señal tras un notch). Si es más del 80 % y no hay latidos, el AD8232 no está recibiendo el ECG (electrodos sin contacto o cable desconectado): se muestra «SIN CONTACTO» y qué revisar. Un ECG real se mide igual aunque tenga 1 mV de interferencia.
7. Con el Arduino los filtros de la página (pasa-altas 0,5 Hz, notch 60 Hz y pasa-bajas 40 Hz) se encienden solos, porque la señal cruda del AD8232 trae la red y la deriva; al volver a la simulación se restauran.

La página usa su propio detector (recibe la señal completa a 250 Hz). La FC que calcula el Arduino aparece en su tarjeta solo si el sketch es la **versión 3 o posterior**: los sketches anteriores contaban la onda T y el ruido como latidos (marcaban ~190–200 lpm), así que su FC se ignora y la página pide cargar `ecg_plotter_teoria.ino` v3. Con el formato del Serial Plotter (25–40 puntos/s) no hay señal suficiente para medir: se muestra «--».

### 5.4. API REST

| Método y ruta | Acceso | Descripción |
|---------------|--------|-------------|
| `POST /api/auth/registro` | público | Crea cuenta (hash bcrypt) |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/yo` | público / sesión | Sesión con cookie `httpOnly` (JWT) |
| `GET /api/arduino/status` | sesión | Estado del Arduino |
| `POST /api/arduino/comando` | sesión | `{ "comando": "LED", "valor": 1 }` (espera el ACK) |
| `POST /api/arduino/puerto` | sesión | `{ "accion": "liberar" \| "conectar" }`: suelta el USB para subir un sketch y lo vuelve a abrir |
| `GET /api/arduino/stream` | sesión | Flujo SSE: `samples`, `bpm`, `status` |
| `GET /api/arduino/comandos` | sesión | Últimos comandos propios |
| `POST/GET/DELETE /api/mediciones`, `GET /api/mediciones/resumen` | sesión | Historial de BPM del usuario |
| `GET /api/admin/usuarios`, `PATCH /api/admin/usuarios/:id` | admin | Listar y activar/desactivar usuarios |

### 5.5. Seguridad aplicada

* Contraseñas con **bcrypt** (nunca en claro) y comparación de tiempo constante ante correos inexistentes.
* **Sequelize** usa consultas parametrizadas (previene inyección SQL); validaciones además en el servidor.
* Sesión en cookie **httpOnly + SameSite=Lax**; la API solo acepta JSON.
* **Límite de intentos** de login/registro por IP.
* Los comandos al Arduino pasan por una **lista blanca** con validación de valores; cada uno queda auditado en `comandos_log`.
* Secretos en `.env` (ignorado por Git). Si sirves la web por HTTPS, pon `COOKIE_SECURE=true`.

### 5.6. Pruebas

Automáticas (requieren MySQL de XAMPP encendido; usan la base aparte `arduino_ecg_test`):

```bash
npm test
```

Cubren 30 casos: protocolo del puente (incluidos el formato del Serial Plotter, el cambio a modo web, las líneas `R`/`D`, la detección automática del puerto y liberar/reconectar), comandos válidos e inválidos, registro, login, inyección SQL, hash bcrypt, permisos admin, SSE, historial y logout (20; los 9 de la API necesitan MySQL) y, en `tests/detector.test.js` (10, sin MySQL), el detector de latidos (precisión de ±2 lpm entre 40 y 180 lpm; ±3 lpm con ruido, red de 60 Hz y deriva), la continuidad de fase del generador y la respuesta en frecuencia de los filtros.

Lista de verificación manual:

1. `npm run db:check` → tres ✔.
2. Sin sesión, la tarjeta Arduino muestra “Inicia sesión…” y `http://localhost:3000/api/arduino/status` responde 401.
3. Crear cuenta e iniciar sesión → aparece el nombre y la tarjeta Arduino.
4. **Probar conexión (PING)** → el registro muestra `PING → OK (pong)`.
5. Marcar **LED externo** → el LED de D8 se enciende (con hardware) y la casilla se mantiene tras confirmar el Arduino.
6. **Usar señal del Arduino** → el monitor cambia a “ECG real · Arduino” y el BPM aparece en unos 5 s. Sin electrodos debe mostrar «--» con un aviso, nunca un número.
7. Abrir una segunda pestaña con la misma sesión, cambiar el LED en una → se refleja en la otra.
8. Activar **Guardar mi frecuencia cardíaca** → aparecen filas en el historial y en phpMyAdmin (`mediciones`).
9. Desconectar un electrodo → *Electrodos: ⚠ Sueltos*.
10. Cerrar sesión → el panel vuelve a bloquearse.

### 5.7. Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| `No se pudo conectar a MySQL` | MySQL no está en *Start* en XAMPP, o `DB_*` incorrectos |
| `Access denied for user 'root'` | Cambiaste la contraseña de root: ponla en `DB_PASSWORD` |
| «El puerto COMx está ocupado» | El Serial Plotter / Monitor Serie del IDE (u otra pestaña con «Conectar Arduino») usa el puerto: ciérralo; el servidor reconecta solo |
| «No se encontró ningún Arduino» | Cable solo de carga, placa sin conectar o driver CH340 sin instalar. `npm run puertos` lo confirma |
| El IDE no puede subir el sketch | `npm start` tiene el puerto: pulsa **Liberar puerto** en la página (o cierra el servidor) |
| «No llegan datos legibles…» | El sketch usa otra velocidad: escribe `0` en el Monitor Serie para volver a 115200 |
| Señal enorme o diminuta | Ajusta `ARDUINO_COUNTS_PER_MV` |
| Puerto 3000 ocupado | Ya hay un `npm start` abierto en otra terminal, o cambia `PORT` en `.env` |

> **Aviso:** el sistema con Arduino sigue siendo **educativo**; no es un dispositivo médico, no sirve para diagnóstico y no debe usarse para decisiones de salud.

---

## 6. Versión web publicada en Vercel (cualquier celular o computador)

El simulador (generador de ECG, ruido, filtros, detector de latidos y BPM) es 100 % JavaScript del lado del navegador, así que se publica gratis como **sitio estático** en [Vercel](https://vercel.com). La configuración ya está en `vercel.json` (raíz del repositorio): el «build» solo copia `ecg-signal-simulator/src/public` a `public/` y Vercel la publica con cabeceras de seguridad. En *Settings → Build and Deployment*, el *Framework Preset* debe ser **Other** (Vercel a veces detecta «Express» por el servidor de Node; con «Other» se publica como sitio estático).

**Publicarlo (una sola vez, unos 2 minutos):**

1. Entra a <https://vercel.com/new> y elige **Continue with GitHub** (cuenta gratuita *Hobby*).
2. Autoriza a Vercel a leer el repositorio `teoria_de_senales_ecg_arduino` e impórtalo con **Import**.
3. No cambies nada (Vercel lee `vercel.json`) y pulsa **Deploy**. Obtendrás un enlace `https://<nombre>.vercel.app` que cualquiera puede abrir.
4. Cada `git push` a `main` actualiza la página sola.

**Qué funciona en la versión publicada:**

* Simulador, ruido, filtros, detector de latidos y teoría, en cualquier celular o computador.
* **Cuentas e historial**: cualquiera con el enlace puede crear su cuenta, iniciar sesión y guardar su frecuencia cardíaca. Lo atiende la función `api/index.js` (la misma app Express de `npm start`, sin el Arduino por el servidor) y se guarda en **MySQL en la nube** (siguiente apartado).
* **Arduino en vivo por USB** en Chrome o Edge de computador: conecta la placa a ese computador y pulsa **Conectar Arduino** (Web Serial; requiere HTTPS, que Vercel ya da). Safari y Firefox no tienen Web Serial.

### 6.1. Base de datos MySQL para la página publicada

Vercel no puede conectarse al MySQL de XAMPP: ese servidor solo existe dentro de tu computador. Por eso la base se pone en un MySQL **en la nube**, y tanto la página publicada como `npm start` pueden usar la misma (las cuentas creadas desde el enlace aparecen también en tu computador).

1. Crea una base MySQL gratuita. Recomendado: [TiDB Cloud](https://tidbcloud.com) (compatible con MySQL, plan gratuito, entra con GitHub) → *Create Cluster* (Starter/Serverless) → *Connect* → elige **Connect With: General** y copia la cadena `mysql://…`. Sirve cualquier MySQL accesible desde Internet (Aiven, Railway, el de tu universidad…).
2. Cambia el final de la cadena por `/arduino_ecg` (el nombre de la base; si no existe se crea sola).
3. En Vercel → tu proyecto → **Settings → Environment Variables** agrega:
   * `DATABASE_URL` = la cadena del paso 2 (con tu contraseña).
   * `ADMIN_EMAILS` = tu correo (así solo tú eres administrador; sin esto, el primer usuario que se registre lo sería).
4. **Deployments → ⋯ → Redeploy** (las variables se aplican en el siguiente despliegue).
5. **Opcional, para conservar tus usuarios de XAMPP:** pon la misma `DATABASE_URL` en tu `.env`, enciende MySQL en XAMPP y ejecuta `npm run migrar-nube`. Copia usuarios, historial y comandos (con el mismo id; si lo repites no duplica nada). Si dejas `DATABASE_URL` en `.env`, `npm start` también usará la base de la nube.

La conexión a la nube va cifrada (TLS) automáticamente. Las tablas se crean solas en el primer uso. El secreto de las sesiones se deriva de la contraseña de la base si no defines `JWT_SECRET`, así no hay que configurar nada más.
