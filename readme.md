# Image Viewer

<p align="center"><img src="icon/icon128.png"></p>
<p align="center">Image Viewer is a manifest V3 Chrome extension that  improves your image viewing experience.</p>

If you like this extension, you can buy me a coffee at:
https://ko-fi.com/tonymilktea

## Features

1. Collect and view all images on the page.
2. Support images in iframes.
3. Disable simple lazy loading.
4. Search and scroll to the original image on the page.
5. Fit, zoom, rotate and mirror the image.
6. Hotkey for image reverse search.
7. Download collected images.
8. Easy to use.
9. And more...

## Installation

You can install this extension from [Chrome Web Store](https://chrome.google.com/webstore/detail/image-viewer/ghdcoodfcolpdebbdhbgkbodbjololfl) or follow steps below:

1. Download the source code and place it anywhere you want.
2. Open your browser and go to `chrome://extensions`.
3. Enable Developer Mode.
4. Click the "Load Unpacked" button and select the folder with the source code.

Any tabs opened before the installation require a reload.

## How to use

After adding this extension to your browser, it is recommended to pin it to the toolbar.

To activate the Image Viewer, click on the extension icon or right-click and choose this extension.

Right-clicking the icon will show a menu that lets you start the Image Viewer disabled size filter or start with the last picked image (use it when the right-click menu is disabled).

<table>
  <tr>
    <td>Action</td>
    <td>Controls</td>
  </tr>
  <tr>
    <td>Pick image</td>
    <td><kbd>right-click</kbd> on the image<br>(size filter will use this image as reference)</td>
  </tr>
  <tr>
    <td rowspan="3">View previous/next image</td>
    <td><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd><kbd>←</kbd></td>
  </tr>
  <tr>
    <td>Scroll on the control bar</td>
  </tr>
  <tr>
    <td>Scroll on the close button</td>
  </tr>
  <tr>
    <td rowspan="2">Scroll to original image</td>
    <td><kbd>Enter</kbd></td>
  </tr>
  <tr>
    <td><kbd>click</kbd> "Move To" button on the control bar</td>
  </tr>
  <tr>
    <td rowspan="2"><kbd>middle-click</kbd> the original image</td>
    <td><kbd>middle-click</kbd> on the image</td>
  </tr>
  <tr>
    <td><kbd>0</kbd> both number row and number pad</td>
  </tr>
  <tr>
    <td>Drag image</td>
    <td><kbd>click</kbd> and <kbd>drag</kbd></td>
  </tr>
  <tr>
    <td>Fitting image</td>
    <td>Click fitting buttons on the control bar</td>
  </tr>
  <tr>
    <td>Reset image</td>
    <td><kbd>double-click</kbd> anywhere</td>
  </tr>
  <tr>
    <td>Zoom image</td>
    <td>Scroll on the image</td>
  </tr>
  <tr>
    <td>Rotate image</td>
    <td>Hold <kbd>Alt</kbd> and scroll</td>
  </tr>
  <tr>
    <td>Mirror image</td>
    <td>Hold <kbd>Alt</kbd> and <kbd>click</kbd></td>
  </tr>
  <tr>
    <td>Image reverse search</td>
    <td>Press the defined hotkeys</td>
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

The entire project was written in Vanilla JavaScript with extension API support for Chromium-based browsers. ~~It should work on Firefox, but it has not been tested yet.~~ Part of the code uses CSS :has() selector, which Firefox still does not yet support in the stable version (Aug 2023).

The standalone `image-viewer.js` should work on all modern browsers, and you can use it on your own website.

You can also run your own activation script using Tampermonkey or other alternatives to start `image-viewer.js`.

## ToDo

1. `image-viewer.min.js`
2. handle more edgy cases
3. bugs fix

## History

The prototype of this project was created by Eky Kwan under the MIT License. However, the license file was either lost or not included in the Chrome Web Store version.

The first release v0.1 was launched on 2012-07-05, and the last release v0.1.6 was on 2012-08-12.

The author of the translation in `_locales` is unknown.

Since I started using this extension, many new features have been added to the project. You can find the oldest version that I have [here](https://github.com/hospotho/Image-Viewer-backup), and some mirroring websites may still have the raw version of v0.1.6.

The old version was hard to extend, and I felt tired of it in June 2022. Therefore, I decided to clean up all the old-style, messy jQuery code and rewrite the project completely.

The rewrite is now complete and has also been upgraded to manifest V3.

The project is currently developed and maintained by me.

## License

MIT license