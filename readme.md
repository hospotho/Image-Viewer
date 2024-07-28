# Image Viewer

<p align="center"><img src="icon/icon128.png"></p>
<p align="center">Image Viewer is a manifest V3 Chrome extension that improves your image viewing experience.</p>

If you like this extension, you can [buy me a coffee](https://ko-fi.com/tonymilktea)

## Features

1. Collect and view all images on the page.
2. Support video posters and images in iframes.
3. Auto replace lazy loaded or resized images with original image.
4. Redirect middle click to original image to open link you want.
5. Go to original image on the page.
6. Fit, zoom, rotate and mirror the image.
7. Hotkey for image reverse search.
8. Download collected images.
9. Easy to use.
10. And more...

## Installation

You can install release version from [Chrome Web Store](https://chrome.google.com/webstore/detail/image-viewer/ghdcoodfcolpdebbdhbgkbodbjololfl) or development version follow steps below:

1. Download the source code and place it anywhere you want.
2. Open your browser and go to `chrome://extensions`.
3. Enable Developer Mode.
4. Click the "Load Unpacked" button and select the folder with the source code.

Note: Any tabs opened before the installation require a reload.

## How to use

After adding this extension to your browser, it is recommended to pin it to the toolbar.

For image tabs, Image Viewer will be activate automatically.

For normal websites, you can activate Image Viewer by choose this extension from the right-click menu, click its icon on the toolbar or use keyboard hotkey (default <kbd>Alt</kbd>+<kbd>1</kbd>).

For additional options, right-click the extension icon on the toolbar. You can start the Image Viewer with disabled size filter or start with the last picked image (use it when the right-click menu is disabled by the website).

<table>
  <tr>
    <td>Action</td>
    <td>Controls</td>
  </tr>
  <tr>
    <td>Pick image<br>(size filter will use this image as reference)</td>
    <td><kbd>right-click</kbd> on the image</td>
  </tr>
  <tr>
    <td rowspan="3">View previous/next image</td>
    <td><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>w</kbd><kbd>a</kbd><kbd>s</kbd><kbd>d</kbd></td>
  </tr>
  <tr>
    <td>Scroll on the control bar</td>
  </tr>
  <tr>
    <td>Scroll on the close button</td>
  </tr>
  <tr>
    <td>Fast navigation<br>(10 images, no throttle)</td>
    <td><kbd>Ctrl</kbd>+<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></td>
  </tr>
  <tr>
    <td>Auto navigation / Slideshow<br>(until end or user interrupt)</td>
    <td><kbd>Shift</kbd>+<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd></td>
  </tr>
  <tr>
    <td rowspan="2">Go to original image on page</td>
    <td><kbd>Enter</kbd></td>
  </tr>
  <tr>
    <td><kbd>click</kbd> "Move To" button on the control bar</td>
  </tr>
  <tr>
    <td rowspan="2"><kbd>middle-click</kbd> the original image<br>(Open tab for post, video, etc.)</td>
    <td><kbd>middle-click</kbd> on the image</td>
  </tr>
  <tr>
    <td><kbd>0</kbd> both number row and numeric keypad</td>
  </tr>
  <tr>
    <td>Fitting image</td>
    <td>Click fitting buttons on the control bar</td>
  </tr>
  <tr>
    <td rowspan="2">Move image</td>
    <td><kbd>click</kbd> and <kbd>drag</kbd></td>
  </tr>
  <tr>
    <td><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>w</kbd><kbd>a</kbd><kbd>s</kbd><kbd>d</kbd></td>
  </tr>
  <tr>
    <td>Reset image</td>
    <td><kbd>double-click</kbd> anywhere</td>
  </tr>
  <tr>
    <td rowspan="2">Zoom image</td>
    <td>Scroll on the image</td>
  </tr>
  <tr>
    <td><kbd>Alt</kbd>+<kbd>↑</kbd><kbd>↓</kbd><kbd>w</kbd><kbd>s</kbd></td>
  </tr>
  <tr>
    <td rowspan="2">Rotate image</td>
    <td>Hold <kbd>Alt</kbd> and scroll</td>
  </tr>
  <tr>
    <td><kbd>Alt</kbd>+<kbd>←</kbd><kbd>→</kbd><kbd>a</kbd><kbd>d</kbd></td>
  </tr>
  <tr>
    <td>Mirror image</td>
    <td>Hold <kbd>Alt</kbd> and <kbd>click</kbd></td>
  </tr>
  <tr>
    <td>Image reverse search</td>
    <td>Press the hotkeys defined in setting</td>
  </tr>
  <tr>
    <td>Change background color<br>(loop: transparent -> black -> white)</td>
    <td><kbd>Shift</kbd>+<kbd>b</kbd></td>
  </tr>
  <tr>
    <td>Download collected images</td>
    <td><kbd>Shift</kbd>+<kbd>d</kbd> (default)</td>
  </tr>
  <tr>
    <td>Enable auto scroll</td>
    <td><kbd>Shift</kbd>+<kbd>r</kbd> (default)</td>
  </tr>
  <tr>
    <td rowspan="2">Close image viewer</td>
    <td><kbd>ESC</kbd> or <kbd>NumpadAdd</kbd></td>
  </tr>
  <tr>
    <td>Click the close button</td>
  </tr>
  <tr>
    <td>Close current tab</td>
    <td><kbd>right-click</kbd> the close button</td>
  </tr>
</table>

## Browser support

The entire project was written in Vanilla JavaScript with extension API supported by Chromium-based browsers. It should also work on Firefox, but it has not been tested yet.

The standalone `image-viewer.js` should work on all modern browsers, and you can integrated into your own website with own collect image script.

You may also use `image-viewer.js` with your own script with Tampermonkey or other alternatives.

## ToDo

1. `image-viewer.min.js`
2. Demo page

## History

The prototype of this project was created by Eky Kwan under the MIT License, and the author of the translations in `_locales` is unknown. The first release v0.1 was launched on 2012-07-05, and the last release v0.1.6 was on 2012-08-12. However, the license file was either lost or not included in the Chrome Web Store version.

Since I started using this extension, many new features have been added to the project. You can find the oldest version [here](https://github.com/hospotho/Image-Viewer-Legacy), some mirroring websites may still have the raw version of v0.1.6.

The old version was hard to extend, and I felt tired of it in June 2022. Therefore, I decided to clean up all the old-style, messy jQuery code and rewrite the project completely. The rewrite is now complete and has also been upgraded to manifest V3.

This project is currently developed and maintained by me.

## License

MIT license