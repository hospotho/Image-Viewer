const ImageViewerUtils = {
  closeImageViewer: function () {
    document.documentElement.classList.remove('has-image-viewer')
    const viewer = document.querySelector('.__shadow__image-viewer')
    viewer.addEventListener('transitionend', () => viewer.remove())
    viewer.style.transition = 'opacity 0.1s'
    viewer.style.opacity = '0'
    return
  },

  simpleUnlazyImage: async function () {
    function getImageSize(src) {
      return new Promise(resolve => {
        console.log(`Fetch image size of ${src}`)
        const img = new Image()
        img.onload = () => resolve(img.naturalWidth)
        img.onerror = () => resolve(0)
        img.src = src
        setTimeout(() => resolve(0), 3000)
      })
    }

    const imgList = document.querySelectorAll('img:not(.simpleUnlazy)')
    const listSize = imgList.length
    if (!listSize) return

    console.log('Try to unlazy image')
    console.log(`${listSize} image found`)

    const passList = ['class', 'style', 'src', 'alt', 'loading', 'crossorigin', 'height', 'width', 'sizes', 'onerror']
    const asyncList = []
    const regex = /(?:https?:\/)?\/\S+/g
    const protocol = window.location.protocol

    for (const img of imgList) {
      img.classList.add('simpleUnlazy')
      asyncList.push(
        new Promise(async resolve => {
          const naturalSize = img.naturalWidth
          for (const attr of img.attributes) {
            if (passList.includes(attr.name)) continue

            const match = [...attr.value.matchAll(regex)]
            if (match.length === 0) continue
            if (match.length === 1) {
              const lazySize = await getImageSize(match[0][0])
              if (lazySize <= naturalSize) continue

              const newURL = match[0][0].replace(/https?:/, protocol)
              img.src = newURL
              img.srcset = newURL
              resolve(attr.name)
            }
            if (match.length > 1) {
              const first = match[0][0]
              const last = match[match.length - 1][0]
              const [firstSize, LastSize] = await Promise.all([getImageSize(first), getImageSize(last)])
              if (firstSize <= naturalSize && LastSize <= naturalSize) continue

              const large = LastSize > firstSize ? last : first
              const newURL = large.replace(/https?:/, protocol)
              img.src = newURL
              img.srcset = newURL
              resolve(attr.name)
            }
          }
          img.loading = 'eager'
          resolve('')
        })
      )
    }

    const lazyName = (await Promise.all(asyncList)).filter(n => n)
    if (lazyName.length !== 0) {
      for (const name of [...new Set(lazyName)]) {
        console.log(`Unlazy ${lazyName.filter(x => x === name).length} img with ${name} attr`)
      }
    } else {
      console.log('No lazy src attribute found')
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  },

  getAllImage: function (options) {
    const imageUrls = []
    for (const img of document.getElementsByTagName('img')) {
      imageUrls.push(img.currentSrc)
    }

    for (const node of document.querySelectorAll('*')) {
      const bg = window.getComputedStyle(node).backgroundImage
      if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
        imageUrls.push(bg.substring(4, bg.length - 1).replace(/['"]/g, ''))
      }
    }

    for (const img of document.querySelectorAll('video[poster]')) {
      imageUrls.push(img.poster)
    }

    return [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && (!options.svgFilter || url.slice(-4) !== '.svg'))
  },

  getImageList: function (options) {
    const imageUrls = []
    for (const img of document.getElementsByTagName('img')) {
      if ((img.clientWidth >= options.minWidth && img.clientHeight >= options.minHeight) || !img.complete) {
        imageUrls.push(img.currentSrc)
      }
    }

    for (const node of document.querySelectorAll('*')) {
      if (node.clientWidth < options.minWidth || node.clientWidth < options.minHeight) continue
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

    return [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && (!options.svgFilter || url.slice(-4) !== '.svg'))
  }
}
