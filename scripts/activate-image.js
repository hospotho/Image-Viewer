;(function () {
  'use strict'

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

  function getImageList(options) {
    var imageUrls = []
    for (const img of document.querySelectorAll('img[src]')) {
      if ((img.clientWidth === options.minWidth && img.clientHeight === options.minHeight) || !img.complete) {
        imageUrls.push(img.src)
      }
    }

    for (const node of document.querySelectorAll('*')) {
      if (node.clientWidth < options.minWidth || node.clientWidth < options.minHeight) break
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

    if (!document.documentElement.classList.contains('has-unlazy')) {
      simpleUnlazyImage()
    }

    chrome.runtime.sendMessage('get_args', args => {
      const [srcUrl] = args
      const type = document.querySelector(`img[src="${srcUrl}"`)
      if (type) {
        options.minWidth = type.clientWidth
        options.minHeight = type.clientHeight
      } else {
        options.minWidth = 0
        options.minHeight = 0
        options.sizeCheck = true
      }

      var uniqueImageUrls = getImageList(options)
      if (uniqueImageUrls.indexOf(srcUrl) !== -1) {
        options.index = uniqueImageUrls.indexOf(srcUrl)
      } else {
        uniqueImageUrls.unshift(srcUrl)
      }

      typeof imageViewer === 'function'
        ? imageViewer(uniqueImageUrls, options)
        : chrome.runtime.sendMessage('load_script', res => {
            imageViewer(uniqueImageUrls, options)
          })
    })
  })
})()
