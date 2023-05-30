;(function () {
  'use strict'

  const rawText = `
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
1. Image viewer now collects images after website adding new content.
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
2. Improve performance of right click image pickup.
3. Add an icon image pre-check before unlazy image to improve performance.
4. Enhance the method of getting image wrapper size
5. Bug fixes

1.13 [2023-03-18]:
1. Improve right click image pickup performance.
2. Improve stability on image unlazy.
3. Extend the loading time limit for images inside image viewer.
4. Fix lot of typos and bugs.

1.12 [2023-02-14]:
1. Add this popup page to show release notes when install or update.
2. Improve stability.
3. Add domain white list for image unlazy.
  // create issues on github if you want to add domain to the list
  // may move to option page or just hide in source code

1.11 [2023-02-11]:
1. Images are now order by its real location.
3. No longer use dataURL, ObjectURL is faster and better for the browser to render images.
2. Min size filter will also considers wrapper of the selected image.
4. Some website that disabled right click menu. Add "view last right click" in icon menu to handle it.

1.10 [2023-02-11]:
1. Add MoveTo support for iframe images.
2. Improve right click image pickup
3. Improve image check size method.

1.9  [2023-01-13]:
1. Support image pickup using right click.
2. Delay execution of worker script to improve performance.

1.8  [2022-10-30]:
1. Improve the support of viewing images inside iframe.
2. Refactor code to tidy up code related to iframe.

1.7  [2022-10-04]:
1. Improve support on iframe images.
2. Improve simpleUnlazyImage().
3. Add more keyboard shortcuts and svg filter in option.

1.6  [2022-09-03]:
1. Support images inside iframe.
2. Improve data transfer between content script and background.

1.5  [2022-08-22]:
1. Renew simpleUnlazyImage().
2. Improve image-viewer.js
3. Support hotkey for reverse search image.

1.4  [2022-08-10]:
1. Improve simpleUnlazyImage().
2. Support video element.
3. Improve MoveTo button logic.
4. Prevent input leak out from image viewer.
5. Improve simpleUnlazyImage().
6. Add utility.js to separate utility function.

1.3  [2022-07-01]:
1. Delay loading of image-viewer.js to improve performance.
2. Add command support.
3. Improve image unlazy.
4. Renew activate image method to increase readability.

1.2  [2022-07-01]:
1. Add simpleUnlazyImage() to unlazy image before getting image list.
2. Change CSS to pin image viewer counter .

1.1  [2022-07-01]:
1. Support mirror effect.
2. Replace old transform method with matrix to improve performance.

1.0  [2022-06-29]:
First release on github.
`
  function createNotes() {
    const data = rawText
      .split('\n\n')
      .map(t => t.trim())
      .map(t => t.split('\n'))

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
      el.innerHTML = message
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
