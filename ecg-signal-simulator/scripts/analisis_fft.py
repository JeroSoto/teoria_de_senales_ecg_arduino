"""
Script de Análisis de Señales ECG - Transformada Rápida de Fourier (FFT) y Filtrado DSP
Asignatura: Teoría de Señales (Universidad de Manizales)
Autores: Jerónimo Soto Villada & Milady Cristina Guapacha Montoya
"""

import os
import numpy as np
import scipy.signal as signal
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def generar_ecg_sintetico(fs=250, bpm=75, duracion=5.0, nivel_ruido=0.15, red_60hz=True, deriva=True):
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
    
    ruido = np.random.normal(0, nivel_ruido, N)
    
    if red_60hz:
        ruido += 0.25 * np.sin(2 * np.pi * 60 * t)
        
    if deriva:
        ruido += 0.40 * np.sin(2 * np.pi * 0.15 * t)
        
    return t, ecg_limpio + ruido, ecg_limpio

def calcular_fft(s, fs):
    N = len(s)
    fft_vals = np.fft.rfft(s)
    freqs = np.fft.rfftfreq(N, 1.0/fs)
    magnitud = np.abs(fft_vals) * (2.0 / N)
    return freqs, magnitud

def main():
    fs = 250
    bpm = 75
    duracion = 5.0
    
    t, ecg_contaminado, ecg_limpio = generar_ecg_sintetico(fs=fs, bpm=bpm, duracion=duracion)
    freqs, mag_cruda = calcular_fft(ecg_contaminado, fs)
    
    # --- Aplicar Filtros Digitales SciPy ---
    # 1. Filtro Pasa-Altas (Butterworth 0.5 Hz)
    b_hp, a_hp = signal.butter(2, 0.5 / (fs / 2), btype='highpass')
    ecg_hp = signal.filtfilt(b_hp, a_hp, ecg_contaminado)
    
    # 2. Filtro Notch (60 Hz)
    b_notch, a_notch = signal.iirnotch(60.0 / (fs / 2), Q=30.0)
    ecg_notch = signal.filtfilt(b_notch, a_notch, ecg_hp)
    
    # 3. Filtro Pasa-Bajas (Butterworth 40 Hz)
    b_lp, a_lp = signal.butter(2, 40.0 / (fs / 2), btype='lowpass')
    ecg_filtrado = signal.filtfilt(b_lp, a_lp, ecg_notch)
    
    _, mag_filtrada = calcular_fft(ecg_filtrado, fs)
    
    # --- Directorio de Salida ---
    out_dir = os.path.join(os.path.dirname(__file__), '../results')
    os.makedirs(out_dir, exist_ok=True)
    
    # --- Gráfica 1: Tiempo vs Frecuencia (FFT) ---
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(10, 6), dpi=150)
    fig.subplots_adjust(hspace=0.4)
    
    ax1.plot(t, ecg_contaminado, color='#ff4757', linewidth=1, label='ECG con Ruido (60Hz + Deriva + EMG)')
    ax1.set_title('Señal ECG en el Dominio del Tiempo ($f_s = 250$ Hz, 75 BPM)', fontsize=11, fontweight='bold')
    ax1.set_xlabel('Tiempo (segundos)')
    ax1.set_ylabel('Amplitud (mV)')
    ax1.grid(True, linestyle='--', alpha=0.5)
    ax1.legend(loc='upper right')
    
    ax2.plot(freqs, mag_cruda, color='#00e5ff', linewidth=1.2, label='Espectro de Magnitud FFT')
    ax2.axvline(x=1.25, color='#00ff88', linestyle='--', label='Frecuencia Fundamental (1.25 Hz = 75 BPM)')
    ax2.axvline(x=60.0, color='#ff4757', linestyle='--', label='Interferencia Red Eléctrica (60 Hz)')
    ax2.set_xlim([0, 100])
    ax2.set_title('Espectro de Frecuencia mediante FFT (0 - 100 Hz)', fontsize=11, fontweight='bold')
    ax2.set_xlabel('Frecuencia (Hz)')
    ax2.set_ylabel('Magnitud')
    ax2.grid(True, linestyle='--', alpha=0.5)
    ax2.legend(loc='upper right')
    
    path_fig1 = os.path.join(out_dir, 'ecg_time_and_fft.png')
    plt.savefig(path_fig1, bbox_inches='tight')
    plt.close()
    print(f"✅ Gráfica generada: {path_fig1}")
    
    # --- Gráfica 2: Comparación Antes vs Después de Filtrado DSP ---
    fig2, (ax3, ax4) = plt.subplots(2, 1, figsize=(10, 6), dpi=150)
    fig2.subplots_adjust(hspace=0.4)
    
    ax3.plot(t, ecg_contaminado, color='#ff4757', alpha=0.6, label='Señal Cruda')
    ax3.plot(t, ecg_filtrado, color='#00ff88', linewidth=1.5, label='Señal Filtrada (HP 0.5Hz + Notch 60Hz + LP 40Hz)')
    ax3.set_title('Filtrado Digital DSP en el Dominio del Tiempo', fontsize=11, fontweight='bold')
    ax3.set_xlabel('Tiempo (segundos)')
    ax3.set_ylabel('Amplitud (mV)')
    ax3.grid(True, linestyle='--', alpha=0.5)
    ax3.legend(loc='upper right')
    
    ax4.plot(freqs, mag_cruda, color='#ff4757', alpha=0.5, label='Espectro Crudo')
    ax4.plot(freqs, mag_filtrada, color='#00ff88', linewidth=1.2, label='Espectro Filtrado')
    ax4.set_xlim([0, 80])
    ax4.set_title('Atenuación Frecuencial de Ruido y Tono de 60 Hz', fontsize=11, fontweight='bold')
    ax4.set_xlabel('Frecuencia (Hz)')
    ax4.set_ylabel('Magnitud')
    ax4.grid(True, linestyle='--', alpha=0.5)
    ax4.legend(loc='upper right')
    
    path_fig2 = os.path.join(out_dir, 'ecg_filtering_analysis.png')
    plt.savefig(path_fig2, bbox_inches='tight')
    plt.close()
    print(f"✅ Gráfica generada: {path_fig2}")

if __name__ == '__main__':
    main()
