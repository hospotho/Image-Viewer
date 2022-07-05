;(function () {
  'use strict'

  function closeImageViewer() {
    document.documentElement.classList.remove('has-image-viewer')
    var viewer = document.querySelector('.__shadow__image-viewer')
    viewer.addEventListener('transitionend', () => viewer.remove())
    viewer.style.transition = 'opacity 0.1s'
    viewer.style.opacity = '0'
    return
  }

  function simpleUnlazyImage() {
    document.documentElement.classList.add('has-unlazy')
    for (const img of document.querySelectorAll('img[loading]')) {
      img.loading = 'eager'
    }
    var lazyName = ''
    const reg = /^(?:https?:\/)?\/.+/
    const imgList = document.querySelectorAll('img')
    const maxCheck = imgList.length - Math.min(parseInt(imgList.length / 5 + 5), imgList.length)
    top: for (let i = imgList.length - 1; i > maxCheck; i--) {
      for (const attr of imgList[i].attributes) {
        if (attr.name !== 'src' && reg.test(attr.value)) {
          lazyName = attr.name
          break top
        }
      }
    }
    if (!lazyName) return
    console.log(`Unlazy img with ${lazyName} attr`)
    for (const img of document.querySelectorAll(`img[${lazyName}]`)) {
      img.src = img.getAttribute(lazyName).split(' ')[0]
    }
  }

  function getImageList() {
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
    return uniqueImageUrls
  }

  chrome.runtime.sendMessage('get_options', res => {
    if (!res) return
    var {options} = res
    options.closeButton = true
    options.minWidth = 0
    options.minHeight = 0

    if (document.documentElement.classList.contains('has-image-viewer')) {
      closeImageViewer()
      return
    }

    if (!document.documentElement.classList.contains('has-unlazy')) {
      simpleUnlazyImage()
    }

    var uniqueImageUrls = getImageList()
    if (uniqueImageUrls.length === 0) return

    typeof imageViewer === 'function'
      ? imageViewer(uniqueImageUrls, options)
      : chrome.runtime.sendMessage('load_script', res => {
          imageViewer(uniqueImageUrls, options)
        })
  })
})()
