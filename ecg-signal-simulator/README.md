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

1. **Instalar dependencias de Node.js, configurar y iniciar el servidor web:**
   ```bash
   npm install
   cp .env.example .env        # en Windows PowerShell: Copy-Item .env.example .env
   # Abre XAMPP y pulsa "Start" en MySQL, luego:
   npm start
   ```
   Abre tu navegador web en `http://localhost:3000`. La simulación y los filtros funcionan sin iniciar sesión; el Arduino y el historial requieren una cuenta (ver sección 5). No abras `src/public/index.html` con Live Server: la autenticación y las rutas API necesitan el servidor Node.js.

2. **Ejecutar el script de Análisis de Frecuencia (FFT) y Filtrado Digital:**
   ```bash
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
En el espectro de magnitud $|X[k]|$, se identifican claramente:
* **Pico en $1.25\text{ Hz}$:** Frecuencia cardíaca fundamental.
* **Armónicos en $2.5\text{ Hz}, 3.75\text{ Hz}, \dots$:** Forma no sinusoidal del complejo QRS.
* **Pico en $60\text{ Hz}$:** Interferencia capacitiva de la red eléctrica.
* **Lóbulo en $<0.5\text{ Hz}$:** Deriva de la línea base respiratoria.

---

## 4. Estructura del Repositorio
* `src/server.js`: Servidor Express (web + API REST + flujo SSE).
* `src/config/`: variables de entorno (`env.js`) y conexión Sequelize/MySQL (`database.js`).
* `src/models/`: modelos Sequelize `Usuario`, `Medicion` y `ComandoLog`.
* `src/routes/`: rutas `auth`, `arduino`, `mediciones` y `admin`.
* `src/services/`: puente con el Arduino (`arduinoBridge.js`), transporte serial real y Arduino simulado.
* `src/public/`: Aplicación frontend en HTML5 Canvas, CSS3 y JS Vanilla (`auth.js`, `arduinoLink.js`, `history.js`, `api.js` se añadieron en la v2.0).
* `arduino/ecg_serial/ecg_serial.ino`: sketch para Arduino Uno/Nano + AD8232.
* `database/schema.sql`: esquema para importar desde phpMyAdmin.
* `tests/`: pruebas automáticas (`npm test`).
* `.env.example`: plantilla de configuración.
* `scripts/analisis_fft.py`: Script de Python para cálculo de la FFT y filtros SciPy.
* `results/`: Gráficas generadas (`ecg_time_and_fft.png`, `ecg_filtering_analysis.png`).
* `docs/teoria_senales.md`: Apuntes teóricos detallados de la asignatura.

---

## 5. Versión 2.0: Arduino, MySQL y usuarios

> **Suposición documentada:** el proyecto usa una simulación educativa y permite capturar señal real con un Arduino Uno/Nano y módulo ECG AD8232 conectado por USB (comunicación serial a 115200 baudios).

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
   2. Abre `arduino/ecg_serial/ecg_serial.ino` en el Arduino IDE y súbelo a la placa (Uno/Nano, 115200 baudios en el Monitor Serie para verificar).
   3. Ejecuta `npm run puertos` y verifica cuál de los puertos corresponde a la placa. En Windows, COM3/COM4 pueden ser puertos Bluetooth virtuales; no los elijas a menos que el Arduino IDE los muestre para la placa.
   4. Pon el puerto verificado en `ARDUINO_PORT` y `ARDUINO_MODE=serial` en `.env`. Cierra el Monitor Serie del IDE (solo un programa puede usar el puerto).
6. **Iniciar:** `npm start` y abre `http://localhost:3000`.
7. **Crear cuenta:** botón **Crear cuenta** (el primer usuario queda como administrador). También por terminal:
   ```bash
   npm run usuario -- "Nombre Apellido" correo@ejemplo.com Clave1234 admin
   ```
8. **Usar el Arduino:** inicia sesión → tarjeta **Arduino** → **Usar señal del Arduino**. Sin hardware, el modo `simulate` emula un Arduino con el mismo protocolo.

### 5.3. Protocolo serial

Líneas de texto terminadas en `\n`.

| Dirección | Mensaje | Significado |
|-----------|---------|-------------|
| Arduino → PC | `I,ECG_ARDUINO,1.0,fs=250` | Anuncio al arrancar |
| Arduino → PC | `S,<adc>` | Muestra del ECG (0–1023) a `fs` Hz |
| Arduino → PC | `H,<bpm>` | Frecuencia cardíaca calculada a bordo |
| Arduino → PC | `L,<0\|1>` | 1 = electrodo suelto |
| Arduino → PC | `A,<CMD>,<OK\|ERR>[,info]` | Confirmación de comando |
| PC → Arduino | `PING`, `START`, `STOP`, `LED,<0\|1>`, `FS,<125\|250\|500>` | Comandos permitidos (lista cerrada) |

**Conversión a mV:** el servidor resta la componente continua con un promedio móvil exponencial (τ ≈ 1,5 s, equivale a un pasa-altas muy suave) y divide por `ARDUINO_COUNTS_PER_MV` (≈ 225 para AD8232 con referencia de 5 V). Ajusta ese valor si la señal se ve muy grande o pequeña.

### 5.4. API REST

| Método y ruta | Acceso | Descripción |
|---------------|--------|-------------|
| `POST /api/auth/registro` | público | Crea cuenta (hash bcrypt) |
| `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/yo` | público / sesión | Sesión con cookie `httpOnly` (JWT) |
| `GET /api/arduino/status` | sesión | Estado del Arduino |
| `POST /api/arduino/comando` | sesión | `{ "comando": "LED", "valor": 1 }` (espera el ACK) |
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

Cubren 14 casos: protocolo del puente, comandos válidos e inválidos, registro, login, inyección SQL, hash bcrypt, permisos admin, SSE, historial y logout.

Lista de verificación manual:

1. `npm run db:check` → tres ✔.
2. Sin sesión, la tarjeta Arduino muestra “Inicia sesión…” y `http://localhost:3000/api/arduino/status` responde 401.
3. Crear cuenta e iniciar sesión → aparece el nombre y la tarjeta Arduino.
4. **Probar conexión (PING)** → el registro muestra `PING → OK (pong)`.
5. Marcar **LED externo** → el LED de D8 se enciende (con hardware) y la casilla se mantiene tras confirmar el Arduino.
6. **Usar señal del Arduino** → el monitor cambia a “ECG real · Arduino AD8232” y el BPM sigue al Arduino.
7. Abrir una segunda pestaña con la misma sesión, cambiar el LED en una → se refleja en la otra.
8. Activar **Guardar mi frecuencia cardíaca** → aparecen filas en el historial y en phpMyAdmin (`mediciones`).
9. Desconectar un electrodo → *Electrodos: ⚠ Sueltos*.
10. Cerrar sesión → el panel vuelve a bloquearse.

### 5.7. Solución de problemas

| Síntoma | Causa probable |
|---------|----------------|
| `No se pudo conectar a MySQL` | MySQL no está en *Start* en XAMPP, o `DB_*` incorrectos |
| `Access denied for user 'root'` | Cambiaste la contraseña de root: ponla en `DB_PASSWORD` |
| `Opening COM3: Access denied` | El Monitor Serie del IDE u otro programa usa el puerto |
| `File not found` en el puerto | `ARDUINO_PORT` incorrecto: ejecuta `npm run puertos` |
| Señal enorme o diminuta | Ajusta `ARDUINO_COUNTS_PER_MV` |
| Puerto 3000 ocupado | Cambia `PORT` en `.env` |

> **Aviso:** el sistema con Arduino sigue siendo **educativo**; no es un dispositivo médico, no sirve para diagnóstico y no debe usarse para decisiones de salud.
