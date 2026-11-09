# Caracterización de la señal de ejemplo (generada por scripts/analisis_fft.py)

Parámetros: 75 lpm, fs = 250 Hz, 8 s, ruido gaussiano σ = 0.15 mV (semilla 42), red de 60 Hz (0.25 mV) y deriva de 0.15 Hz (0.40 mV).

| Medida | Señal con ruido | Señal limpia |
|---|---|---|
| Número de muestras N | 2000 | 2000 |
| Duración (s) | 8.0 | 8.0 |
| Frecuencia de muestreo fs (Hz) | 250 | 250 |
| Periodo de muestreo Ts (ms) | 4.0 | 4.0 |
| Mínimo (mV) | -0.939 | -0.212 |
| Máximo (mV) | 1.611 | 1.187 |
| Media (mV) | 0.089 | 0.061 |
| Valor RMS (mV) | 0.408 | 0.185 |
| Pico a pico (mV) | 2.550 | 1.400 |

| Medida en frecuencia / periodicidad | Valor |
|---|---|
| Periodo cardíaco nominal T = 60/BPM | 0.80 s |
| Frecuencia fundamental nominal f = BPM/60 | 1.25 Hz |
| Resolución de la FFT Δf = fs/N | 0.125 Hz |
| Frecuencia fundamental medida en la FFT (0.7–3.5 Hz) | 1.250 Hz → 75.0 lpm |
| Frecuencia de Nyquist fs/2 | 125 Hz |
| RMS del error respecto a la señal limpia, antes del filtrado | 0.368 mV |
| RMS del error respecto a la señal limpia, después de HP + notch + LP | 0.083 mV |
