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

Para un segmento de 8 segundos ($N = 2000$ muestras):

$$\Delta f = \frac{250}{2000} = 0.125\text{ Hz}$$

A 75 lpm, 8 s contienen exactamente 10 latidos (8 s × 1.25 Hz), de modo que la fundamental coincide con el bin $k = 10$ de la FFT y los armónicos con $k = 20, 30, \dots$. Si la ventana no contiene un número entero de periodos aparece *fuga espectral* (la energía de una línea se reparte entre bins vecinos).

## 3. Ecuaciones de Filtros Digitales IIR (Tiempo Discreto)
1. **Filtro Pasa-Altas (Deriva de Línea Base, $f_c = 0.5\text{ Hz}$):**
   $$y[n] = \alpha \cdot (y[n-1] + x[n] - x[n-1]), \quad \alpha = \frac{1}{1 + 2\pi f_c T_s}$$

2. **Filtro Pasa-Bajas (Ruido EMG / Alta Frecuencia, $f_c = 40\text{ Hz}$):**
   $$y[n] = y[n-1] + \alpha \cdot (x[n] - y[n-1]), \quad \alpha = -(1-\cos\omega_c) + \sqrt{(1-\cos\omega_c)^2 + 2(1-\cos\omega_c)}, \quad \omega_c = \frac{2\pi f_c}{f_s}$$

   Este valor de $\alpha$ hace que la ganancia valga exactamente $1/\sqrt{2}$ ($-3\text{ dB}$) en $f_c$. La fórmula más conocida $\alpha = \frac{\omega_c T_s}{1 + \omega_c T_s}$ solo es válida si $f_c \ll f_s$; con $f_c = 40\text{ Hz}$ y $f_s = 250\text{ Hz}$ daría un corte real cercano a 29 Hz.

3. **Filtro Notch (60 Hz, red eléctrica):** ceros sobre el círculo unidad en $\pm\omega_0$ y polos en radio $r = 0.95$:

   $$H(z) = \frac{1 - 2\cos\omega_0\, z^{-1} + z^{-2}}{1 - 2r\cos\omega_0\, z^{-1} + r^2 z^{-2}}, \quad \omega_0 = \frac{2\pi \cdot 60}{f_s}$$

## 4. Detección de latidos y cálculo del BPM (Pan-Tompkins, 1985)
El navegador mide el BPM con el algoritmo de Pan y Tompkins sobre la señal sin filtrar por el usuario:

1. **Pasa-banda 5–15 Hz** (pasa-altas + pasa-bajas Butterworth de 2.º orden): deja la energía del QRS y elimina deriva, onda T y ruido de red.
2. **Derivada de 5 puntos:** $y[n] = \frac{1}{8}\left(2x[n] + x[n-1] - x[n-3] - 2x[n-4]\right)$ resalta la pendiente del QRS.
3. **Elevación al cuadrado:** todo queda positivo y las pendientes grandes pesan más.
4. **Integración en ventana móvil de 150 ms:** convierte cada QRS en un solo máximo.
5. **Umbral adaptativo:** $\text{umbral} = NPK + 0.25\,(SPK - NPK)$, con $SPK$ y $NPK$ las estimaciones de los niveles de pico de señal y de ruido (se actualizan con un filtro exponencial de factor 1/8). Periodo refractario de 250 ms.
6. **Localización del pico R:** la señal integrada tiene una meseta de unos 150 ms, así que su máximo cambia de latido a latido (hasta ±30 ms de jitter). Al decidir que hubo latido se busca el máximo de $|y_{\text{pasa-banda}}|$ en los 200 ms anteriores; ese instante, con resolución de una muestra, es el que se usa para medir $T_{RR}$.

El intervalo entre dos latidos es $T_{RR}$; se toma la **mediana de los últimos 5** y

$$\text{BPM} = \frac{60}{T_{RR}}, \qquad f = \frac{\text{BPM}}{60}\ \text{Hz}$$

Hasta que el detector termina la calibración (2 s) y mide dos intervalos, el simulador muestra «--» en lugar de inventar un valor.

## 5. Generador sintético: continuidad de fase
Para que mover el control de BPM no produzca saltos en la forma de onda, el generador **acumula la fase** del latido, $\varphi[n] = \varphi[n-1] + \frac{\text{BPM}}{60} T_s \pmod 1$, en lugar de calcularla como $(t \bmod T)/T$ con un $T$ que cambia.
