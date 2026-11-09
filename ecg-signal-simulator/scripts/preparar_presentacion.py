"""
Recorta los paneles de las gráficas de results/ para la presentación web (src/public/presentacion/img).
Ejecutar después de scripts/analisis_fft.py si se vuelven a generar las gráficas.
"""
import os
from PIL import Image

RAIZ = os.path.join(os.path.dirname(__file__), '..')
SALIDA = os.path.join(RAIZ, 'src', 'public', 'presentacion', 'img')

# (archivo de origen, nombre de salida, (y_inicio, y_fin)) medidos sobre las imágenes de 150 dpi
RECORTES = [
    ('ecg_time_and_fft.png', 'panel_tiempo.png', (5, 388)),
    ('ecg_time_and_fft.png', 'panel_fft.png', (398, 780)),
    ('ecg_time_and_fft.png', 'panel_zoom.png', (790, 1177)),
    ('ecg_filtering_analysis.png', 'filtrado_tiempo.png', (0, 432)),
    ('ecg_filtering_analysis.png', 'filtrado_frecuencia.png', (438, 877)),
]

os.makedirs(SALIDA, exist_ok=True)
for origen, nombre, (y0, y1) in RECORTES:
    imagen = Image.open(os.path.join(RAIZ, 'results', origen))
    recorte = imagen.crop((0, y0, imagen.width, y1))
    recorte.save(os.path.join(SALIDA, nombre), optimize=True)
    print('Panel generado:', nombre, recorte.size)
