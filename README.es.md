# wvmTool

[日本語](README.md) | [English](README.en.md) | [中文](README.zh.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Français](README.fr.md)

![alt text](pics/top.png)

Esta es una aplicación web de edición de mosaicos de vídeo contenida en un navegador.

## Disponible en la siguiente URL

https://dikmri.github.io/wvmTool/

## Navegadores compatibles

- Última versión de Google Chrome (recomendado)
- Última versión de Microsoft Edge
-Última versión de Firefox
- Safari: algunas funciones pueden estar limitadas (compatibilidad con WebCodecs/WebGL2)

## Características principales

- Arrastrar y soltar carga de videos MP4
- Gestionar múltiples pistas de mosaico rectangulares de forma independiente
- Dibujar, mover y cambiar el tamaño del área del mosaico usando los tiradores de las esquinas.
- Girar el rango del mosaico (tecla Q/E, restablecer con R)
- Posición, tamaño, rotación y animación de mostrar/ocultar del mosaico basado en fotogramas clave
- Vista previa del mosaico en tiempo real usando WebGL2 (se admite rotación)
- Decodificación/codificación rápida de cuadros con WebCodecs
- Exportar MP4 con audio (hereda automáticamente la tasa de bits del video original)
- Durante la reproducción, puedes ocultar el borde superpuesto y comprobar el mosaico puro.
- Muestra la lista de accesos directos desde el botón "Cómo usar" en la pantalla
- **Soporte multilingüe**: Japonés / Inglés / Chino / 한국어 / Español / Français (cambiar con encabezado)

## Cómo utilizar

1. Arrastre y suelte el video MP4 en la ventana gráfica (o haga clic para seleccionar el archivo)
2. Haga clic en "+ Agregar" en el panel de herramientas para crear una pista de mosaico.
- Cambia automáticamente al modo de dibujo cuando se agrega
3. Dibuje el área del mosaico arrastrando la ventana gráfica.
4. Agregue fotogramas clave en las posiciones deseadas mientras busca en la línea de tiempo (tecla K)
5. Si es necesario, cambie al modo de selección, arrastre el rectángulo para moverlo y use los controles de las esquinas para cambiar su tamaño.
6. Haga clic en "Iniciar exportación" en el panel de exportación.

### Operaciones de seguimiento en mosaico

- **Múltiples pistas**: si agrega varias pistas, cada pista tendrá su propia área de mosaico independiente.
- Botón **●/○**: activar/desactivar la pista
- **× Eliminar**: elimina la pista seleccionada
- **Tamaño del mosaico**: ajusta la granularidad del mosaico con el control deslizante (5 a 80 px)

### Atajos de teclado

| Clave | Operación |
|------|------|
| Espacio | Reproducir/Detener |
| FlechaIzquierda | Retroceder un fotograma |
| FlechaDerecha | Adelante 1 fotograma |
| Mayús+← / → | Mover al primer/último fotograma |
| k | Agregar fotograma clave en la posición actual |
| Eliminar | Eliminar fotograma clave seleccionado |
| Q | Gire el rango del mosaico 5 grados en sentido antihorario |
| mi | Gire el rango del mosaico 5° en el sentido de las agujas del reloj |
| R | Restablecer la rotación del rango del mosaico (0°) |
| H | Grabar visualización/ocultación de mosaico como fotograma clave |
| Yo | Añadir nueva pista de mosaico |
| norte | Ajuste el tamaño de la pantalla para que se ajuste a la pantalla (restablecimiento del zoom) |
| Rueda | Acercar/alejar |

> Durante la reproducción, el borde del rango del mosaico está oculto y solo puede ver el efecto de mosaico.

### Exportar configuración

| Configuración | Contenidos |
|------|------|
| Códec | Automático (prioridad H.264) / H.264 / VP9 / AV1 |
| Calidad de imagen | Máxima calidad de imagen (cuantizador 16) / Alta calidad de imagen (22) / Estándar (28) / Baja calidad de imagen (35). El valor predeterminado es "Alta calidad" |
| Sufijo | Cadena que se agregará al nombre del archivo de salida (predeterminado: `_mosaic`) |

En H.264, la calidad se controla mediante VBR (Variable Bitrate). Detecta automáticamente la tasa de bits del video original y la multiplica por el multiplicador de configuración de calidad para determinar la tasa de bits objetivo (alta calidad = igual que el video original, calidad más alta = 1,5x, estándar = 0,65x, baja calidad = 0,35x). FPS se detecta automáticamente a partir del vídeo original. El audio se transmite desde el vídeo original.

Si agrega una pista de mosaico y dibuja un rectángulo en el modo de dibujo, cambiará automáticamente al modo de selección una vez que se complete el dibujo. El rango del mosaico también se puede especificar fuera del rango del video.

## Privacidad/Seguridad

**Los archivos de video no se cargan en el servidor. ** Todo el procesamiento se completa dentro del navegador del usuario. No hay comunicación con API externas.

## Limitaciones conocidas

- Algunas funciones pueden estar limitadas en Safari según la compatibilidad de WebCodecs/WebGL2.
- Los vídeos muy largos y de alta resolución pueden quedarse sin memoria.
- La exportación requiere la API WebCodecs del navegador

## Configuración técnica

| Capa | Tecnología |
|----------|------|
| Marco de interfaz de usuario | Esbelto 5 + TypeScript |
| Herramientas de construcción | Vida 6 |
| Decodificación/codificación de vídeo | API de códecs web |
| Representación | WebGL2 (sombreador de mosaico compatible con rotación) |
| Reserva de Canvas2D | Para entornos que no admiten WebGL2 (se admite rotación) |
| Procesamiento en segundo plano | Trabajador web + OffscreenCanvas |
| Análisis de contenedores MP4 | mp4box.js |
| múltiplex MP4 | mezclador de mp4 |
| Alojamiento | Páginas de GitHub |

## Política de desempeño

- No tener datos de fotogramas de vídeo en el hilo de la interfaz de usuario.
- Web Worker realiza todo el procesamiento pesado (decodificación, codificación, aplicación de mosaico)
- Procesamiento de mosaicos GPU usando sombreador WebGL2 (hasta 8 pistas simultáneamente)
- Minimizar el impacto en el hilo principal usando OffscreenCanvas
- Siempre `close()` VideoFrame después de su uso para evitar pérdidas de memoria.
- Al exportar, no todos los fotogramas se conservan ni se procesan secuencialmente

## Método de desarrollo

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# プロダクションビルド
npm run build

# ビルドのプレビュー
npm run preview
```

## Cómo implementar

GitHub Actions se compila e implementa automáticamente en páginas de GitHub al ingresar a la rama "principal".

Para implementación manual:

```bash
npm run build
# dist/ ディレクトリの内容を GitHub Pages にデプロイ
```
