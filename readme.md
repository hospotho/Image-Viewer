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

After add this extension to your browser, recommended to pin this extension on toolbar.

Click the icon or right click on a image and choose this extension to activate Image Viewer. Right click the icon will show a option to disable size filter.

<table>
  <tr>
    <td>Action</td>
    <td>Controls</td>
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

The entire project was written in Vanilla JavaScript with extension API supported by Chromium-based browsers, may work on Firefox but not yet tested. Standalone `image-viewer.js` should work on all modern browser, you can use it in your own website. You may also run your own activate script using tampermonkey or other alternatives to start `image-viewer.js` .

## ToDo

1. `image-viewer.min.js`
2. ...

## History

The prototype of this project is by Eky Kwan, MIT License. License file was lost or not in Chrome Web Store version.

First release v0.1 on 2012-07-05 and last release v0.1.6 on 2012-08-12

The author of translate in `_locales` is unknown.

Since I was using this extension, lot of features were added to this project. I backup the oldest version at <a href="https://github.com/hospotho/Image-Viewer-backup">here</a>, but some changes were already added me.

Old version is hard to extend and I felt tired to it at 2022-06. so I decided to clear up all those old style messy jQuery code and undertake a complete rewrite of it.

The rewrite is complete and also upgraded to manifest V3.

Currently developed and maintained by me.

## License

MIT license