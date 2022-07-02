;(function () {
  'use strict'

  function simpleUnlazyImage() {
    document.documentElement.classList.add('has-unlazy')
    const imgList = document.querySelectorAll('img')
    for (const img in imgList) {
      img.loading = 'eager'
    }
    const index1 = parseInt(Math.random() * imgList.length)
    const index2 = parseInt(Math.random() * imgList.length)
    const index3 = parseInt(Math.random() * imgList.length)
    const attributes = [...imgList[index1].attributes, ...imgList[index2].attributes, ...imgList[index3].attributes]
    const check = []
    for (const attr of attributes) {
      if (attr.name !== 'src' && /^(?:https?:\/)?\/.+/.test(attr.value)) check.push({[attr.name]: attr.value})
    }
    if (check.length === 0) return
    const lazyName = Object.keys(check[0])[0]
    const lazyimgList = document.querySelectorAll(`img[${lazyName}]`)
    console.log(`Unlazy img with ${lazyName} attr`)
    for (const img of lazyimgList) {
      img.src = img.getAttribute(lazyName).split(' ')[0]
    }
  }

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

    if (!document.documentElement.classList.contains('has-unlazy')) {
      simpleUnlazyImage()
    }

    var imageUrls = []
    for (const img of document.querySelectorAll('img[src]')) {
      if ((img.clientWidth >= options.minWidth && img.clientHeight >= options.minHeight) || !img.complete) {
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
