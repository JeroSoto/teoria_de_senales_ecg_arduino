# Módulo de Teoría de Señales - Notas Técnicas y Formulación

## 1. Modelo Matemático del ECG Sintético
La señal de ECG sintética $x(t)$ se modela mediante la superposición de funciones gaussianas asociadas a cada deflexión $i \in \{P, Q, R, S, T\}$ en el dominio del tiempo dentro de cada periodo cardíaco $T = 60 / \text{BPM}$:

$$x(t) = \sum_{i \in \{P,Q,R,S,T\}} a_i \cdot \exp\left( -\frac{(t - \mu_i)^2}{2 \sigma_i^2} \right) + \eta(t)$$

Donde:
* $a_i$: Amplitud relativa de la onda ($a_R = 1.20$, $a_P = 0.12$, $a_T = 0.25$, etc.).
* $\mu_i$: Ocurrencia temporal relativa en el ciclo.
* $\sigma_i$: Ancho temporal de la onda (determina su ancho de banda en frecuencia).
* $\eta(t)$: Ruido térmico gaussiano $n(t) \sim \mathcal{N}(0, \sigma_n^2)$, interferencia de red $A_{\text{red}} \sin(2\pi 60 t)$ y deriva $A_{\text{deriv}} \sin(2\pi 0.15 t)$.

## 2. Transformada Rápida de Fourier (FFT)
Dado un conjunto de $N$ muestras $\{x[0], x[1], \dots, x[N-1]\}$ tomadas a $f_s = 250\text{ Hz}$, la resolución frecuencial $\Delta f$ viene dada por:

$$\Delta f = \frac{f_s}{N}$$

Para un segmento de 5 segundos ($N = 1250$ muestras):

$$\Delta f = \frac{250}{1250} = 0.2\text{ Hz}$$

## 3. Ecuaciones de Filtros Digitales IIR (Tiempo Discreto)
1. **Filtro Pasa-Altas (Deriva de Línea Base, $f_c = 0.5\text{ Hz}$):**
   $$y[n] = \alpha \cdot (y[n-1] + x[n] - x[n-1]), \quad \alpha = \frac{1}{1 + 2\pi f_c T_s}$$

2. **Filtro Pasa-Bajas (Ruido EMG / Alta Frecuencia, $f_c = 40\text{ Hz}$):**
   $$y[n] = y[n-1] + \alpha \cdot (x[n] - y[n-1]), \quad \alpha = \frac{2\pi f_c T_s}{1 + 2\pi f_c T_s}$$
