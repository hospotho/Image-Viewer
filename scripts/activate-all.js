;(function () {
  'use strict'

  chrome.runtime.sendMessage('get_options', res => {
    if (!res) return
    var {options} = res
    options.closeButton = true

    if (document.documentElement.classList.contains('has-image-viewer')) {
      document.documentElement.classList.remove('has-image-viewer')
      var viewer = document.querySelector('body > div.__shadow__image-viewer')
      viewer.addEventListener('transitionend', () => viewer.remove())
      viewer.style.transition = 'opacity 0.1s'
      viewer.style.opacity = '0'
      return
    }

    var imageUrls = []
    for (const img of document.querySelectorAll('img[src]')) {
      imageUrls.push(img.src)
    }

    for (const node of document.querySelectorAll('*')) {
      const style = window.getComputedStyle(node)
      const bg = style.backgroundImage
      if (!bg) break
      if (bg.indexOf('url') === 0 && bg.indexOf('.svg")') === -1) {
        imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
      }
    }

    var uniqueImageUrls = []
    for (const img of imageUrls) {
      if (!uniqueImageUrls.includes(img)) {
        uniqueImageUrls.push(img)
      }
    }

    if (uniqueImageUrls.length === 0) return
    if (typeof imageViewer === 'function') {
      imageViewer(uniqueImageUrls, options)
    } else {
      chrome.runtime.sendMessage('load_script', res => {
        imageViewer(uniqueImageUrls, options)
      })
    }
  })
})()
