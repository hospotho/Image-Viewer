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

You can install this extension on <a href="https://chrome.google.com/webstore/detail/image-viewer/ghdcoodfcolpdebbdhbgkbodbjololfl">Chrome Web Store</a> or follow step below.

1. Download the source code and place it anywhere you want.
2. Open your browser and go to `chrome://extensions`.
3. Enable Developer Mode.
4. Click on Load Unpacked button and select the folder of source code.

Tab opened before the installaion require a reload.

## How to use

After add this extension to your browser, recommended to pin this extension on toolbar.

Click the icon or right click on a image and choose this extension to activate Image Viewer. Right click the icon will show a option to disable size filter.

|             Action              |                           Controls                           |
| :-----------------------------: | :----------------------------------------------------------: |
|    view previous/next image     | arrow key<br>scroll on control bar<br>scroll on close button |
|    scroll to original image     |    click moveTo button on control bar<br>press Enter key     |
| middle click the original image |                  middle click on the image                   |
|           drag image            |            click and hold anywhere of the viewer             |
|          fitting image          |     click one of the four fitting buttons on control bar     |
|           reset image           |             double click anywhere of the viewer              |
|           zoom image            |                     scroll on the image                      |
|          rotate image           |             hold alt key and scroll on the image             |
|          mirror image           |             hold alt key and click on the image              |
|      image reverse search       |                  press the defined hotkeys                   |
|        close the viewer         |   click on the close button<br>press ESC or NumpadAdd key    |
|          close the tab          | right click on close button<br>(only on tab without history) |

## Browser support

The entire project was written in Vanilla JavaScript with extension API supported by Chromium-based browsers, may work on Firefox but not yet tested. Standalone `image-viewer.js` should work on all modern browser, you can use it in your own website. You may also run your own activate script using tampermonkey or other alternatives to start `image-viewer.js` .

## ToDo

1. `image-viewer.min.js`
2. ...

## History

The prototype of this project is by Eky Kwan, MIT License. License file was lost or not in Chrome Web Store version.

First release v0.1 on 2012-07-05 and last release v0.1.6 on 2012-08-12

The author of translate in `_locales` is unknow.

Since I was using this extension, lot of features were added to this project. I backup the oldest version at <a href="https://github.com/hospotho/Image-Viewer-backup">here</a>, but some changes were already added me.

Old version is hard to extend and I felt tired to it at 2022-06. so I decided to clear up all those old style messy jQuery code and undertake a complete rewrite of it.

The rewrite is complete and also upgraded to manifest V3.

Currently developed and maintained by me.

## License

MIT license