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

  function getImageSize(src) {
    return new Promise((resolve, reject) => {
      let img = new Image()
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = reject
      img.src = src
    })
  }

  async function simpleUnlazyImage() {
    const imgList = document.querySelectorAll('img')
    const countClass = [...document.documentElement.classList].find(x => x.startsWith('unlazy-count-'))
    if (imgList.length === parseInt(countClass?.substring(13))) return
    document.documentElement.classList.remove(countClass)
    document.documentElement.classList.add(`unlazy-count-${imgList.length}`)

    var lazyName = ''
    var mult = false
    const reg = /^(?:https?:\/)?\/.+/
    const multReg = /(?:https?:\/)?\/\S+\.[a-zA-Z]{3,4}/g
    const maxCheck = imgList.length - Math.min(parseInt(imgList.length / 5 + 5), imgList.length)
    top: for (let i = imgList.length - 1; i > maxCheck; i--) {
      for (const attr of imgList[i].attributes) {
        if (attr.name === 'src' || !reg.test(attr.value)) continue
        lazyName = attr.name

        const match = [...attr.value.matchAll(multReg)]
        if (match.length === 1) break top
        const first = match[0][0]
        const last = match[match.length - 1][0]
        const [firstSize, LastSize] = await Promise.all([getImageSize(first), getImageSize(last)])
        mult = LastSize > firstSize
        break top
      }
    }
    if (!lazyName) return
    console.log(`Unlazy img with ${lazyName} attr`)
    const lazyImage = document.querySelectorAll(`img[${lazyName}]`)
    const getLazyURL = mult ? match => match.slice(-1) : match => match[0]
    for (const img of lazyImage) {
      const newURL = getLazyURL([...img.getAttribute(lazyName).matchAll(multReg)])
      img.src = newURL
      img.srcset = newURL
    }
    for (const img of imgList) img.loading = 'eager'
  }

  function getImageList(options) {
    var imageUrls = []
    for (const img of document.querySelectorAll('img[src]')) {
      if ((img.clientWidth >= options.minWidth && img.clientHeight >= options.minHeight) || !img.complete) {
        imageUrls.push(img.src)
      }
    }

    for (const node of document.querySelectorAll('*')) {
      if (node.clientWidth < options.minWidth || node.clientWidth < options.minHeight) break
      const bg = window.getComputedStyle(node).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
      }
    }

    for (const video of document.querySelectorAll('video[poster]')) {
      if (video.clientWidth >= options.minWidth && video.clientHeight >= options.minHeight) {
        imageUrls.push(video.poster)
      }
    }

    return [...new Set(imageUrls)]
  }

  chrome.runtime.sendMessage('get_options', async res => {
    if (!res) return
    var {options} = res
    options.closeButton = true

    if (document.documentElement.classList.contains('has-image-viewer')) {
      closeImageViewer()
      return
    }

    await simpleUnlazyImage()

    var uniqueImageUrls = getImageList(options)
    if (uniqueImageUrls.length === 0) return

    typeof imageViewer === 'function'
      ? imageViewer(uniqueImageUrls, options)
      : chrome.runtime.sendMessage('load_script', res => {
          imageViewer(uniqueImageUrls, options)
        })
  })
})()
