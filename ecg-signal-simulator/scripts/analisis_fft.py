"""
Script de Análisis de Señales ECG - Transformada Rápida de Fourier (FFT) y Filtrado DSP
Asignatura: Teoría de Señales (Universidad de Manizales)
Autores: Jerónimo Soto Villada & Milady Cristina Guapacha Montoya

Genera la señal sintética (mismo modelo que el simulador web), la caracteriza, calcula su FFT, aplica los
filtros digitales y guarda en ../results: dos gráficas (.png) y la tabla de caracterización (.md);
y en ../data una muestra de 2 s de ECG limpio (.json) para probar el código sin generar nada.
Con la semilla fija, el resultado es idéntico en cada ejecución.
"""

import os
import json
import numpy as np
import scipy.signal as signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

SEMILLA = 42   # el ruido gaussiano es aleatorio; con semilla fija las gráficas son reproducibles


def generar_ecg_sintetico(fs=250, bpm=75, duracion=8.0, nivel_ruido=0.15, red_60hz=True, deriva=True):
    N = int(fs * duracion)
    t = np.linspace(0, duracion, N, endpoint=False)
    
    T_beat = 60.0 / bpm
    fase = (t % T_beat) / T_beat
    
    # Ondas P-QRS-T (Gaussianas)
    def gaussiana(phase, a, center, sigma):
        diff = phase - center
        return a * np.exp(-(diff**2) / (2 * sigma**2))
    
    ecg_limpio = (gaussiana(fase, 0.12, 0.15, 0.025) +  # Onda P
                   gaussiana(fase, -0.15, 0.32, 0.010) + # Onda Q
                   gaussiana(fase, 1.20, 0.35, 0.012) +  # Onda R
                   gaussiana(fase, -0.25, 0.38, 0.012) + # Onda S
                   gaussiana(fase, 0.25, 0.65, 0.045))  # Onda T
    
    ruido = np.random.default_rng(SEMILLA).normal(0, nivel_ruido, N)
    
    if red_60hz:
        ruido += 0.25 * np.sin(2 * np.pi * 60 * t)
        
    if deriva:
        ruido += 0.40 * np.sin(2 * np.pi * 0.15 * t)
        
    return t, ecg_limpio + ruido, ecg_limpio

def calcular_fft(s, fs):
    """Espectro de magnitud de una sola cara. Eje X: k·fs/N (Hz). Eje Y: amplitud de la sinusoide equivalente."""
    N = len(s)
    fft_vals = np.fft.rfft(s)
    freqs = np.fft.rfftfreq(N, 1.0 / fs)
    magnitud = np.abs(fft_vals) * (2.0 / N)
    return freqs, magnitud

def rms(x):
    return float(np.sqrt(np.mean(np.square(x))))

def caracterizar(x, fs):
    """Medidas básicas de la señal (sección 4.3 de la especificación de la entrega)."""
    return {
        'muestras': len(x),
        'duracion_s': len(x) / fs,
        'fs_hz': fs,
        'Ts_ms': 1000.0 / fs,
        'minimo': float(np.min(x)),
        'maximo': float(np.max(x)),
        'media': float(np.mean(x)),
        'rms': rms(x),
        'pico_a_pico': float(np.ptp(x)),
    }

def guardar_caracterizacion(ruta, bpm, fs, dur, c_ruido, c_limpia, f0_medida, rms_antes, rms_despues):
    df = fs / (dur * fs)
    filas = [
        ('Número de muestras N', f"{c_ruido['muestras']}", f"{c_limpia['muestras']}"),
        ('Duración (s)', f"{c_ruido['duracion_s']:.1f}", f"{c_limpia['duracion_s']:.1f}"),
        ('Frecuencia de muestreo fs (Hz)', f"{fs}", f"{fs}"),
        ('Periodo de muestreo Ts (ms)', f"{c_ruido['Ts_ms']:.1f}", f"{c_limpia['Ts_ms']:.1f}"),
        ('Mínimo (mV)', f"{c_ruido['minimo']:.3f}", f"{c_limpia['minimo']:.3f}"),
        ('Máximo (mV)', f"{c_ruido['maximo']:.3f}", f"{c_limpia['maximo']:.3f}"),
        ('Media (mV)', f"{c_ruido['media']:.3f}", f"{c_limpia['media']:.3f}"),
        ('Valor RMS (mV)', f"{c_ruido['rms']:.3f}", f"{c_limpia['rms']:.3f}"),
        ('Pico a pico (mV)', f"{c_ruido['pico_a_pico']:.3f}", f"{c_limpia['pico_a_pico']:.3f}"),
    ]
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write('# Caracterización de la señal de ejemplo (generada por scripts/analisis_fft.py)\n\n')
        f.write(f'Parámetros: {bpm} lpm, fs = {fs} Hz, {dur:.0f} s, ruido gaussiano σ = 0.15 mV (semilla {SEMILLA}), '
                'red de 60 Hz (0.25 mV) y deriva de 0.15 Hz (0.40 mV).\n\n')
        f.write('| Medida | Señal con ruido | Señal limpia |\n|---|---|---|\n')
        for nombre, a, b in filas:
            f.write(f'| {nombre} | {a} | {b} |\n')
        f.write('\n| Medida en frecuencia / periodicidad | Valor |\n|---|---|\n')
        f.write(f'| Periodo cardíaco nominal T = 60/BPM | {60.0 / bpm:.2f} s |\n')
        f.write(f'| Frecuencia fundamental nominal f = BPM/60 | {bpm / 60.0:.2f} Hz |\n')
        f.write(f'| Resolución de la FFT Δf = fs/N | {df:.3f} Hz |\n')
        f.write(f'| Frecuencia fundamental medida en la FFT (0.7–3.5 Hz) | {f0_medida:.3f} Hz → {f0_medida * 60:.1f} lpm |\n')
        f.write(f'| Frecuencia de Nyquist fs/2 | {fs / 2:.0f} Hz |\n')
        f.write(f'| RMS del error respecto a la señal limpia, antes del filtrado | {rms_antes:.3f} mV |\n')
        f.write(f'| RMS del error respecto a la señal limpia, después de HP + notch + LP | {rms_despues:.3f} mV |\n')

def exportar_muestra(ruta, fs, bpm, duracion=2.0):
    """Guarda un segmento de ECG limpio (sin ruido) en JSON: fs·duración muestras, en mV."""
    _, _, limpio = generar_ecg_sintetico(fs=fs, bpm=bpm, duracion=duracion, nivel_ruido=0, red_60hz=False, deriva=False)
    datos = {
        'descripcion': 'Segmento de ECG sintético limpio (modelo de 5 gaussianas P-Q-R-S-T), generado por scripts/analisis_fft.py',
        'frecuenciaMuestreoHz': fs,
        'bpm': bpm,
        'duracionSegundos': duracion,
        'unidad': 'mV',
        'numeroMuestras': len(limpio),
    }
    cuerpo = json.dumps(datos, ensure_ascii=False, indent=2)[:-2]            # sin la llave final
    muestras = json.dumps([round(float(v), 4) for v in limpio])
    with open(ruta, 'w', encoding='utf-8') as f:
        f.write(cuerpo + ',\n  "muestras": ' + muestras + '\n}\n')

def main():
    fs = 250
    bpm = 75
    # 8 s = 10 latidos completos a 75 lpm → la fundamental (1,25 Hz) cae exactamente en un bin de la FFT
    duracion = 8.0

    t, ecg_contaminado, ecg_limpio = generar_ecg_sintetico(fs=fs, bpm=bpm, duracion=duracion)
    # Se resta la media (componente DC) para que el bin de 0 Hz no tape el resto del espectro
    freqs, mag_cruda = calcular_fft(ecg_contaminado - np.mean(ecg_contaminado), fs)

    # --- Aplicar Filtros Digitales SciPy (filtfilt = fase cero, solo para análisis fuera de línea) ---
    # 1. Filtro Pasa-Altas (Butterworth 0.5 Hz)
    b_hp, a_hp = signal.butter(2, 0.5 / (fs / 2), btype='highpass')
    ecg_hp = signal.filtfilt(b_hp, a_hp, ecg_contaminado)

    # 2. Filtro Notch (60 Hz)
    b_notch, a_notch = signal.iirnotch(60.0 / (fs / 2), Q=30.0)
    ecg_notch = signal.filtfilt(b_notch, a_notch, ecg_hp)

    # 3. Filtro Pasa-Bajas (Butterworth 40 Hz)
    b_lp, a_lp = signal.butter(2, 40.0 / (fs / 2), btype='lowpass')
    ecg_filtrado = signal.filtfilt(b_lp, a_lp, ecg_notch)

    _, mag_filtrada = calcular_fft(ecg_filtrado - np.mean(ecg_filtrado), fs)

    # --- Caracterización (valores que se escriben en results/caracterizacion.md) ---
    car_ruido = caracterizar(ecg_contaminado, fs)
    car_limpia = caracterizar(ecg_limpio, fs)
    banda = (freqs >= 0.7) & (freqs <= 3.5)                  # 42–210 lpm
    f0_medida = float(freqs[banda][np.argmax(mag_cruda[banda])])
    # Error respecto a la señal limpia sin DC; se ignoran 0,5 s en cada extremo (efectos de borde del filtro)
    borde = int(0.5 * fs)
    ref = (ecg_limpio - np.mean(ecg_limpio))[borde:-borde]
    rms_antes = rms((ecg_contaminado - np.mean(ecg_contaminado))[borde:-borde] - ref)
    rms_despues = rms(ecg_filtrado[borde:-borde] - ref)

    # --- Directorio de Salida ---
    out_dir = os.path.join(os.path.dirname(__file__), '../results')
    os.makedirs(out_dir, exist_ok=True)

    data_dir = os.path.join(os.path.dirname(__file__), '../data')
    os.makedirs(data_dir, exist_ok=True)
    exportar_muestra(os.path.join(data_dir, 'muestra_ecg_sintetico.json'), fs, bpm)
    print(f"Muestra exportada: {os.path.join(data_dir, 'muestra_ecg_sintetico.json')}")

    guardar_caracterizacion(os.path.join(out_dir, 'caracterizacion.md'), bpm, fs, duracion,
                            car_ruido, car_limpia, f0_medida, rms_antes, rms_despues)
    print(f"Tabla generada: {os.path.join(out_dir, 'caracterizacion.md')}")
    print(f"   f0 medida en la FFT = {f0_medida:.3f} Hz -> {f0_medida * 60:.1f} lpm (nominal {bpm})")
    print(f"   RMS del error: {rms_antes:.3f} mV antes -> {rms_despues:.3f} mV después del filtrado")

    # --- Gráfica 1: Tiempo vs Frecuencia (FFT) ---
    f0 = bpm / 60.0
    fig, (ax1, ax2, ax2b) = plt.subplots(3, 1, figsize=(10, 9), dpi=150)
    fig.subplots_adjust(hspace=0.55)

    ax1.plot(t, ecg_contaminado, color='#ff4757', linewidth=1, label='ECG con ruido (60 Hz + deriva + gaussiano)')
    ax1.set_title(f'(a) Señal ECG en el dominio del tiempo ($f_s$ = {fs} Hz, {bpm} lpm, {duracion:.0f} s)', fontsize=11, fontweight='bold')
    ax1.set_xlabel('Tiempo (s)')
    ax1.set_ylabel('Amplitud (mV)')
    ax1.set_xlim([0, duracion])
    ax1.grid(True, linestyle='--', alpha=0.5)
    ax1.legend(loc='upper right')

    ax2.plot(freqs, mag_cruda, color='#0b8fb3', linewidth=1.2, label='Espectro de magnitud (FFT, sin componente DC)')
    ax2.axvline(x=60.0, color='#ff4757', linestyle='--', linewidth=0.9, alpha=0.6, label='Interferencia de red eléctrica (60 Hz)')
    ax2.set_xlim([0, 100])
    ax2.set_title(f'(b) Espectro de frecuencia mediante FFT (0 – 100 Hz, Δf = {fs / (duracion * fs):.3f} Hz)', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Frecuencia (Hz)')
    ax2.set_ylabel('Magnitud (mV)')
    ax2.grid(True, linestyle='--', alpha=0.5)
    ax2.legend(loc='upper right')

    ax2b.plot(freqs, mag_cruda, color='#0b8fb3', linewidth=1.2, label='Espectro de magnitud')
    for k in range(1, 13):
        ax2b.axvline(x=k * f0, color='#00a35c', linestyle='--', alpha=0.45, linewidth=0.9,
                     label=f'Armónicos k·{f0:.2f} Hz (periodicidad del latido)' if k == 1 else None)
    ax2b.axvline(x=0.15, color='#ff9f1a', linestyle=':', linewidth=1.6, label='Deriva de línea base (0.15 Hz)')
    ax2b.set_xlim([0, 15])
    ax2b.set_title('(c) Zoom 0 – 15 Hz: líneas espectrales cada 1.25 Hz = BPM/60', fontsize=11, fontweight='bold')
    ax2b.set_xlabel('Frecuencia (Hz)')
    ax2b.set_ylabel('Magnitud (mV)')
    ax2b.grid(True, linestyle='--', alpha=0.5)
    ax2b.legend(loc='upper right')

    path_fig1 = os.path.join(out_dir, 'ecg_time_and_fft.png')
    plt.savefig(path_fig1, bbox_inches='tight')
    plt.close()
    print(f"Gráfica generada: {path_fig1}")

    # --- Gráfica 2: Comparación Antes vs Después de Filtrado DSP ---
    fig2, (ax3, ax4) = plt.subplots(2, 1, figsize=(10, 6.4), dpi=150)
    fig2.subplots_adjust(hspace=0.5)

    ax3.plot(t, ecg_contaminado, color='#ff4757', alpha=0.6, label='Señal cruda')
    ax3.plot(t, ecg_filtrado, color='#00a35c', linewidth=1.5, label='Señal filtrada (HP 0.5 Hz + notch 60 Hz + LP 40 Hz)')
    ax3.set_title('Filtrado digital en el dominio del tiempo', fontsize=11, fontweight='bold')
    ax3.set_xlabel('Tiempo (s)')
    ax3.set_ylabel('Amplitud (mV)')
    ax3.set_xlim([0, duracion])
    ax3.grid(True, linestyle='--', alpha=0.5)
    ax3.legend(loc='upper right')

    ax4.plot(freqs, mag_cruda, color='#ff4757', alpha=0.6, label='Espectro crudo')
    ax4.plot(freqs, mag_filtrada, color='#00a35c', linewidth=1.2, label='Espectro filtrado')
    ax4.set_xlim([0, 80])
    ax4.set_title('Atenuación de la deriva, de los 60 Hz y del ruido de alta frecuencia', fontsize=11, fontweight='bold')
    ax4.set_xlabel('Frecuencia (Hz)')
    ax4.set_ylabel('Magnitud (mV)')
    ax4.grid(True, linestyle='--', alpha=0.5)
    ax4.legend(loc='upper right')

    path_fig2 = os.path.join(out_dir, 'ecg_filtering_analysis.png')
    plt.savefig(path_fig2, bbox_inches='tight')
    plt.close()
    print(f"Gráfica generada: {path_fig2}")

if __name__ == '__main__':
    main()
