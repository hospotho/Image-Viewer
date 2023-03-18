# Image Viewer

<p align="center"><img src="icon/icon128.png"></p>
<p align="center">Image Viewer is a manifest V3 Chrome extension for improve your images viewing experiences.</p>

If you like this extension, you can buy me a coffee

https://ko-fi.com/tonymilktea
## Features

1. Collect and view all images on the page.
2. Support images in iframes.
3. Disable simple lazy loading.
4. Search and scroll to the original image on the page.
5. Fitting, zoom, rotate and mirror the image.
6. Hotkey for image reverse search.
7. Easy to use.
8. And more...

## Installation

You can install this extension on <a href="https://chrome.google.com/webstore/detail/image-viewer/ghdcoodfcolpdebbdhbgkbodbjololfl">Chrome Web Store</a> or follow steps below.

1. Download the source code and place it anywhere you want.
2. Open your browser and go to `chrome://extensions`.
3. Enable Developer Mode.
4. Click on Load Unpacked button and select the folder of source code.

Tab opened before the installation require a reload.

## How to use

After adding this extension to your browser, it is recommended to pin it to the toolbar.

To activate the Image Viewer, click on the extension icon or right-click and choose this extension. Right-clicking the icon will show a menu that lets you disable the size filter or start the Image Viewer with the last picked image (use it when right click menu is disabled).

<table>
  <tr>
    <td>Action</td>
    <td>Controls</td>
  </tr>
  <tr>
    <td>pickup image</td>
    <td><kbd>right click</kbd> image<br>(size filter will use this image as reference)</td>
  </tr>
  <tr>
    <td rowspan="3">view previous/next image</td>
    <td><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd><kbd>←</kbd></td>
  </tr>
  <tr>
    <td><kbd>scroll</kbd> on control bar</td>
  </tr>
  <tr>
    <td><kbd>scroll</kbd> on close button</td>
  </tr>
  <tr>
    <td rowspan="2">view original image</td>
    <td><kbd>Enter</kbd></td>
  </tr>
  <tr>
    <td><kbd>click</kbd> moveTo button on control bar</td>
  </tr>
  <tr>
    <td><kbd>middle-click</kbd> the original image</td>
    <td><kbd>middle-click</kbd> on the image</td>
  </tr>
  <tr>
    <td>drag image</td>
    <td><kbd>click</kbd> and <kbd>drag</kbd></td>
  </tr>
  <tr>
    <td>fitting image</td>
    <td><kbd>click</kbd> fitting buttons on control bar</td>
  </tr>
  <tr>
    <td>reset image</td>
    <td><kbd>double-click</kbd> anywhere</td>
  </tr>
  <tr>
    <td>zoom image</td>
    <td><kbd>scroll</kbd></td>
  </tr>
  <tr>
    <td>rotate image</td>
    <td>hold <kbd>alt</kbd> and <kbd>scroll</kbd></td>
  </tr>
  <tr>
    <td>mirror image</td>
    <td>hold <kbd>alt</kbd> and <kbd>click</kbd></td>
  </tr>
  <tr>
    <td>image reverse search</td>
    <td>press the defined hotkeys</td>
  </tr>
  <tr>
    <td rowspan="2">close the viewer</td>
    <td><kbd>ESC</kbd> or <kbd>NumpadAdd</kbd></td>
  </tr>
  <tr>
    <td><kbd>click</kbd> close button</td>
  </tr>
  <tr>
    <td>close the tab</td>
    <td><kbd>right-click</kbd> close button</td>
  </tr>
</table>

## Browser support

The entire project was written in Vanilla JavaScript with extension API support for Chromium-based browsers. It should work on Firefox, but it has not been tested yet. The standalone `image-viewer.js` should work on all modern browsers, and you can use it on your own website. You may also run your own activation script using Tampermonkey or other alternatives to start `image-viewer.js`.

## ToDo

1. `image-viewer.min.js`
2. ...

## History

The prototype of this project was created by Eky Kwan under the MIT License. However, the license file was either lost or not included in the Chrome Web Store version.

The first release v0.1 was launched on 2012-07-05 and the last release v0.1.6 was on 2012-08-12.

The author of the translation in `_locales` is unknown.

Since I started using this extension, many new features have been added to the project. You can find the oldest version that I have at <a href="https://github.com/hospotho/Image-Viewer-backup">here </a>, and some mirroring websites may still have the raw version of v0.1.6.

The old version was hard to extend, and I felt tired of it in June 2022. Therefore, I decided to clean up all the old-style, messy jQuery code and undertake a complete rewrite of the project.

The rewrite is now complete and has also been upgraded to manifest V3.

The project is currently developed and maintained by me.

## License

MIT license