# Image Viewer

<p align="center"><img src="icon/icon128.png"></p>
Image Viewer is a manifest V3 Chrome extension for viewing images on a page. It is written for learning manifest V3 and shadow dom.

## Features

1. Image size filter
2. Four basic fitting mode + auto fit image base on setting
3. Index display (index/total)
4. View image whith hotkeys (Next: `right/down`, Prev: `left/up`)
5. View image whith scroll (place cursor on close button or control bar)
6. Scroll to the original image on the page
7. Zoom image `WheelUp/Down`
8. Rotate image `Alt + WheelUp/Down`
9. Mirror image `Alt + click`
10. close window by call window.close() when right click on close button
11. And more...

## Workflow
(May have been change after each update, just for ref)

1. When `chrome.action.onClick` or `chrome.contextMenus.onClick` is triggered, event listener will call `chrome.scripting.executeScript()` to execute `activate-{type}.js` on that page. The script will collect and pass images to `imageViewr()`.
   
2. If `imageViewr()` is not available, background.js will load `image-viewer.js` to that page and pass `imageViewer(imageList, options)` to global scope (isolated world).

3. When `imageViewr()` is called, a image viewer will start to build base on the images and user options passed by `activate-{type}.js`.

4. `buildApp()` will apend main frame and style enclosing by shadow dom to `<body>`.

5. `buildImageList(imageList)` and `initImageList(options)` will fill image to image viewer image list.
   
6. `fitImage(options)` will be called for fitting image.

7. Event listeners of those elements will be added by `addFrameEvent()`, `addImageEvent()` and `addImageListEvent()`. 

8. Image viewer build complete.

## Browser support

The entire project was written in Vanilla JavaScript with Chrome API. Standalone `image-viewer.js` should work on all modern browser, you can write your own activate script and run `image-viewer.js` by tampermonkey or other alternatives.
## ToDo

1. `image-viewer.min.js`
2. release on Chrome Web Store
3. https://hospotho.github.io/Image-Viewer/ to teach user how to use it

## History

The prototype of this project is by Eky Kwan, MIT License. License file was lost or not in Chrome Web Store version.

First release v0.1 on 2012-07-05 and stop at v0.1.6 2012-08-12

The author of translate in `_locales` is unknow.

Since I was using this extension, lot of features were added to this project.

At 2022-06, I felt tired to update it, so I decided to clear up all those old style messy jQuery code and undertake a complete rewrite of it.

Rewrite is done, also upgrade to manifest V3.

Develop and maintain by me <= Now

## License

MIT license