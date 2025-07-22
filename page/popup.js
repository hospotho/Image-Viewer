;(function () {
  'use strict'

  const rawText = `
1.42 [2025-07-23]:
Major Update
Been crazy busy these days, so no time to publish a new release version.
But waiting over 6 months is too long, so here it is
Tons of new features, performance improvements, and bug fixes added
1. Added local folder support, just drag a folder into the browser and use the hotkey or click the icon as usual
2. Implemented info button and info popup, no longer a fake button
  // You can scroll to navigate like other UI elements
3. Added hotkey to download the current image: Ctrl + Shift + D
4. Improved positioning of new tabs, now more like what you'd expect
5. Changed Yandex TLD to .ru, you can use Yandex image reverse search again
6. Tons of performance improvements, especially for large images and cases with many images
7. Improved right-click picker, smarter and more accurate at guessing the needed image size
8. Added support for proxy images
9. Other bug fixes and improvements
P.S. For the latest updates, use the Dev version on GitHub if possible

1.41 [2025-02-06]:
Stability update
This version was originally planned as a major update, but the development of new features was delayed
1. Added a hotkey command for canvas mode
2. Added support for background images in pseudo elements
3. Improved scroll unlazy logic
4. Improved right click image size referencing logic
5. Other bug fixes and improvements
P.S. Starting with this version, the extension will also be published on addons.mozilla.org for Firefox users

1.40 [2024-10-14]:
1. Added a new option to allow users to disable image unlazy on specific domains
2. Introduced a web demo, enabling users to try the feature before installation
3. Updated the options page and added a simple support page
4. Fixed a bug in the new view canvas feature that caused issues on sites like Notion

1.39.1 [2024-10-01]:
Patch Update
1. Fixed a bug in the new view canvas features that caused issues with some sites like Google Sheets

1.39 [2024-09-29]:
Major Update
1. Added an action to the icon context menu allowing users to view canvas elements
  // Note: This feature only supports snapshots, not GIF creation
  // May also be useful for cases where an image is visible but not accessible in normal mode
  // This could include an image drawn on a canvas element
2. Added support for local and blob images to mainstream reverse search
3. Fixed navigation, it will now correctly wait for images to be rendered on the screen
4. The space bar can now be used to send a middle click to an image (previously only "0" could be used)
5. Other bug fixes and improvements

1.38 [2024-09-09]:
Stability update
1. Added support for data URL images to mainstream reverse search
2. Fixed a bug that could change the website's default layout
3. Fixed a bug that could toggle the website's default hotkeys (eg. page navigation)
4. Other bug fixes and improvements

1.37 [2024-08-11]:
Performance and Stability update
1. The control panel will now auto hide after 1.5 seconds of mouse hover
  // move cursor over buttons will toggle the panel again
  // provides clearer view when using scroll to view image
2. Improved image viewer's logic for build/update image list
3. Refactored image collection logic to enhance stability of the image list
4. Rewritten auto scroll logic to ensure no images are skipped
5. Enhanced code quality
6. Other bug fixes and improvements

1.36 [2024-07-22]:
Major Update
1. Added a hotkey for auto navigation (shift + arrow keys)
2. Added ton of code to support of custom element
3. Add sub-image check to improve image unlazy in url mode
4. Improve and refactor iframe image extraction logic
5. Improve CSS and layout of the image viewer
6. Refactor data structure for image info
7. Other bug fixes and improvements

1.35 [2024-07-03]:
1. Reduced zoom & rotate transition flash
2. Improved auto update logic
3. Enhanced ability to find larger size raw images
4. Reworked unlazy logic, no longer need to wait when reopening within a short time
5. Reworked iframe logic, can now handle iframe in iframe cases
6. Fixed a bug that changed current index after image list update
7. Other bug fixes and improvements

1.34 [2024-04-11]:
Stability update
1. Prevented image loading flash in URL mode
2. Add smooth transition for image transform
3. Fixed a bug where AltGraph could not be used with Ctrl in hotkey combinations
  // related hotkey: image transformation and image reverse search
4. Improved code performance
5. Implemented error handling to minimize minor errors displayed to users
6. Added support for new type of unlazy (simulate mouse hover)
7. Other bug fixes and improvements

1.33 [2024-01-15]:
Functional Update
1. Added a new default fit mode option: "Original size (does not exceed window)"
2. Added a maximum size limit (3x) for other fit modes to prevent enlarging small images too much
3. Added a new hotkey (Shift + B) for switching the background color: transparent -> black -> white
4. Added new hotkeys for image transformation:
  // Move: Ctrl + Alt + ↑↓←→ / WASD
  // Zoom: Alt + ↑↓ / WS
  // Rotate: Alt + ←→ / AD
5. Improved auto-scrolling
6. Added support for more edge cases
7. Other bug fixes and improvements

1.32 [2023-12-31]:
1. Improved accuracy of image middle click redirect
2. Enhanced size filter referencing of picking an image by right click
3. Solve CSS issues related to lazy images on some websites
4. Added support for the embed element
5. Refactored and improved code logic
6. Other bug fixes and improvements

1.31 [2023-10-22]:
1. Rotation now rotates around the center of the viewpoint
2. Auto scroll hotkey will toggle auto scroll instead of just starting it
3. Navigation with "WASD" is now supported
4. Support fast navigation by pressing the Ctrl key at the same time to activate it
5. Support memory of last image when restarting in page mode
6. Enhanced code quality
7. Other bug fixes and improvements

1.30 [2023-08-27]:
Stability update
1. Improved SVG filtering
2. Added support for multiple layers unlazy
3. Enhanced logic for getting raw image URLs
4. Added support for more edge cases
5. Other bug fixes and improvements

1.29 [2023-08-08]:
1. Corrected code related to the service worker lifecycle
2. Enhanced unlazy logic to handle additional cases
3. Improved logic for updating the size filter when there are images of the same kind as the picked image
4. Enhanced the user experience on auto scroll
5. Numerous bug fixes and minor improvements

1.28 [2023-07-10]:
Major Update
1. Added a hotkey to manually enable auto scroll
2. Added a hotkey to download images collected by image viewer
  // Note: This extension is not a resource downloader
  // Download functionality is limited to basic features
  // eg. selecting a download range and packaging in a zip file
3. Improved first display time of image viewer
4. Improved middle-click redirect to open the original image's hyperlink
5. Improved correctness of right click image pickup
6. Other bug fixes and improvements

1.27 [2023-07-06]:
1. Improved image selection, decrease the priority of image placeholder and image sprite
2. Improved border display after using moveTo
3. Improved auto scrolling and auto update
4. Some bug fixes

1.26 [2023-06-17]:
1. Improved the logic of using middle click to open the link of current image
2. Fixed a bug that caused jumping in viewer index
3. Fixed a bug that prevented the image viewer from automatically starting for image URLs
4. Other bug fixes and improvements

1.25 [2023-06-04]:
1. AltGraph key now functions the same as Alt key in hotkey
2. More intuitive zoom, where zooming now occurs at the screen center instead of the image center
3. Fixed the incorrect position of the border display after the moveTo operation
4. Fixed a bug that caused a conflict in the scroll function
5. Added a check for iframes to handle a bug in Chrome
6. Removed code that caused extra rendering time
7. Added caching to enhance performance
8. Improved performance on right click image pickup

1.24 [2023-06-01]:
1. Introduces method for old style lazy image
2. Enhance the moveTo function and label border
3. Improve stability of the extension
4. Fix bugs and improve performance

1.23 [2023-05-29]:
1. Add temporary image list storage
2. Significantly reduced startup time by approximately 3-10 times
3. Refine UI
4. Improve code logic

1.22 [2023-05-28]:
1. Support deeper-layer iframes
2. Enhance the moveTo function
3. Revamp border display following moveTo
4. Support additional edge cases
5. Improve performance and fix bugs

1.21 [2023-05-27]:
1. Fixed a bug when getting the image list, so it won't repeat the same image with different sizes
2. Fixed the "moveTo" button, now it functions correctly on websites like Instagram and Twitter
3. Fixed the image update, so it won't jump back to the first image when updating
4. Fixed a bug related to image looping, now it will wait for an image update when it reaches the end

1.20 [2023-05-26]:
1. Improved auto update and auto scroll
2. More stability on image file URLs
3. Added support for more iframe images
4. Improved performance and fixed bugs

1.19 [2023-05-14]:
1. Improve the stability of auto scroll
2. Improve the code logic for better performance
3. Fix a lot of bugs

1.18 [2023-05-04]:
1. Support auto scroll
2. Add options to enable auto scroll and disable hover check
3. Refactor code for better readability
4. Fix bug related to hover check and other minor bugs

1.17 [2023-04-30]:
Stability update
1. Add some code to increase the stability
2. Add handle to more edge cases
3. Fix bugs

1.16 [2023-04-10]:
1. Image viewer now collects images after website adding new content
  // usually website update is toggled by scroll to the end of the page
  // you can archive it by scrolling on the scrollbar or press "End" key on keyboard
  // you may also use other "next page" script/extension
2. Fix issues for youtube thumbnail
3. Fix bugs related to last update
4. Refactor code to improving program structure

1.15 [2023-04-05]:
Large Update
1. Add support on update image in the viewer
2. Solve the problem for image viewer can't be open on some websites
3. Fix CORS issues for iframe images
4. Fix other issues in rare situations
5. Improve performance and fix some bugs

1.14 [2023-04-01]:
1. Improve CSS of image viewer
2. Improve performance of right click image pickup
3. Add an icon image pre-check before unlazy image to improve performance
4. Enhance the method of getting image wrapper size
5. Bug fixes

1.13 [2023-03-18]:
1. Improve right click image pickup performance
2. Improve stability on image unlazy
3. Extend the loading time limit for images inside image viewer
4. Fix lot of typos and bugs

1.12 [2023-02-14]:
1. Add this popup page to show release notes when install or update
2. Improve stability
3. Add domain white list for image unlazy
  // create issues on github if you want to add domain to the list
  // may move to option page or just hide in source code

1.11 [2023-02-11]:
1. Images are now order by its real location
3. No longer use dataURL, ObjectURL is faster and better for the browser to render images
2. Min size filter will also considers wrapper of the selected image
4. Some website that disabled right click menu. Add "view last right click" in icon menu to handle it

1.10 [2023-02-11]:
1. Add MoveTo support for iframe images
2. Improve right click image pickup
3. Improve image check size method

1.9  [2023-01-13]:
1. Support image pickup using right click
2. Delay execution of worker script to improve performance

1.8  [2022-10-30]:
1. Improve the support of viewing images inside iframe
2. Refactor code to tidy up code related to iframe

1.7  [2022-10-04]:
1. Improve support on iframe images
2. Improve simpleUnlazyImage()
3. Add more keyboard shortcuts and svg filter in option

1.6  [2022-09-03]:
1. Support images inside iframe
2. Improve data transfer between content script and background

1.5  [2022-08-22]:
1. Renew simpleUnlazyImage()
2. Improve image-viewer.js
3. Support hotkey for reverse search image

1.4  [2022-08-10]:
1. Improve simpleUnlazyImage()
2. Support video element
3. Improve MoveTo button logic
4. Prevent input leak out from image viewer
5. Improve simpleUnlazyImage()
6. Add utility.js to separate utility function

1.3  [2022-07-01]:
1. Delay loading of image-viewer.js to improve performance
2. Add command support
3. Improve image unlazy
4. Renew activate image method to increase readability

1.2  [2022-07-01]:
1. Add simpleUnlazyImage() to unlazy image before getting image list
2. Change CSS to pin image viewer counter

1.1  [2022-07-01]:
1. Support mirror effect
2. Replace old transform method with matrix to improve performance

1.0  [2022-06-29]:
First release on github
`
  function createNotes() {
    const data = rawText.split('\n\n').map(t => t.trim().split('\n'))

    const noteContainerGroup = document.createElement('div')
    noteContainerGroup.classList.add('note-container-group')
    for (const textList of data) {
      const noteContainer = document.createElement('div')
      noteContainer.classList.add('note-container')

      const bar = document.createElement('button')
      bar.classList.add('bar')
      bar.type = 'button'
      bar.textContent = textList.shift()

      const noteText = document.createElement('div')
      noteText.classList.add('noteText')
      for (const line of textList) {
        const p = document.createElement('p')
        p.textContent = line
        noteText.appendChild(p)
      }

      bar.onclick = () => {
        if (noteContainer.classList.contains('active')) {
          noteContainer.classList.remove('active')
          noteText.style.maxHeight = null
        } else {
          noteContainer.classList.add('active')
          noteText.style.maxHeight = noteText.scrollHeight + 'px'
        }
      }

      noteContainer.appendChild(bar)
      noteContainer.appendChild(noteText)
      noteContainerGroup.appendChild(noteContainer)
    }
    document.body.appendChild(noteContainerGroup)
  }

  function toggleFirstNote() {
    const firstNote = document.querySelector('div.note-container-group > div:nth-child(1) > button')
    firstNote.nextElementSibling.style.transitionDuration = '0s'
    firstNote.click()
    setTimeout(() => (firstNote.nextElementSibling.style.transitionDuration = ''), 100)
  }

  function i18n() {
    chrome.i18n.getAcceptLanguages(languages => {
      const exist = ['en', 'ja', 'zh_CN', 'zh_TW']
      let displayLanguages = 'en'
      for (const lang of languages) {
        if (exist.includes(lang.replace('-', '_'))) {
          displayLanguages = lang
          break
        }
        if (exist.includes(lang.slice(0, 2))) {
          displayLanguages = lang.slice(0, 2)
          break
        }
      }
      document.documentElement.setAttribute('lang', displayLanguages)
    })

    for (const el of document.querySelectorAll('[data-i18n]')) {
      const tag = el.getAttribute('data-i18n')
      const message = chrome.i18n.getMessage(tag)
      if (!message) continue
      el.textContent = message
      if (el.value !== '') el.value = message
    }
  }

  function init() {
    createNotes()
    toggleFirstNote()
    i18n()
  }

  init()
})()
