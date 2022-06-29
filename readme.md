# Image Viewer

Image Viewer is a manifest V3 Chrome extension for viewing images on a page

It is written for learning manifest V3 and shadow dom.

## Features

1. Auto fit image base on setting (4 fitting mode)
2. Image size filter
3. Scroll to the original image on the page
4. Index display (index/total)
5. Zoom image `WheelUp/Down`
6. Rotate image `Alt + WheelUp/Down`
7. Mirror image `Alt + click`
8. View image whith scroll and hotkeys

## ToDo

1. Collect lazy load images.
2. Better image filter (svg, transparent png)
3. `image-viewer.min.js`

## Workflow

1. Content script will load `image-viewer.js` to all page and pass `imageViewer(imageList, options)` to global scope (isolated world).

2. When `chrome.action.onClick` or `chrome.contextMenus.onClick` is triggered, event listener will call `chrome.scripting.executeScript()` to execute `activate-{type}.js` on that page. The script will collect and pass images to `imageViewr()`.

3. When `imageViewr()` is called, a image viewer will start to build base on the images and user options passed by `activate-{type}.js`.

4. `buildApp()` will apend main frame and style enclosing by shadow dom to `<body>`.

5. `buildImageList(imageList)` will fill image list by imageList argument.

6. Event listeners of those elements will be added by `addFrameEvent()`, `addImageEvent()` and `addImageListEvent()`. 

7. At the end `fitImage(options)` will be called for fitting image.

8. Image viewer build complete.

## Browser support

The entire project was written in Vanilla JavaScript with Chrome API, `image-viewer.js` sure work on all modern browser support Shadow DOM v1.

Chrome(>=53) Edge(>=79) Firefox(>=63) Opera(>=40) Safari(>=10)

But this project was only tested on Chrome(103.0.5060.53). Unknow for Edge, Firefox, Safari and etc. browsers

## History

The prototype of this project is by Eky Kwan, MIT License. License file was lost or not in Chrome Web Store version.

First release v0.1 on 2012-07-05 and stop at v0.1.6 2012-08-12

The author of translate in `_locales` is unknow.

Since I was using this extension, lot of features were added to this project.

At 2022-06, I felt tired to update it. So, I decided to clear up all those old style messy jQuery code and undertake a complete rewrite of it.

Rewrite is done, also upgrade to manifest V3. <= Now

## License

MIT license