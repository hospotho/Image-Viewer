const ImageViewerUtils = (function () {
  const passList = ['class', 'style', 'src', 'alt', 'loading', 'crossorigin', 'height', 'width', 'sizes', 'onerror']
  const urlRegex = /(?:https?:\/)?\/\S+/g
  const argsRegex = /(.+\.(?:png|jpeg|jpg|gif|bmp|tiff|webp)).+/i
  const protocol = window.location.protocol

  async function checkImageAttr(img) {
    const argsMatch = img.src.match(argsRegex)
    const attrList = [...img.attributes].filter(attr => !passList.includes(attr.name) && attr.value.match(urlRegex))
    if (!argsMatch && attrList.length === 0) {
      img.loading = 'eager'
      return ''
    }

    const bitSize = await getImageBitSize(img.src.replace(/https?:/, protocol))
    const getImageSize = bitSize ? getImageBitSize : getImageRealSize
    const naturalSize = bitSize || img.naturalWidth

    if (argsMatch) {
      const newURL = argsMatch[1].replace(/https?:/, protocol)
      const lazySize = await getImageSize(newURL)
      if (lazySize > naturalSize) {
        updateImageSource(img, newURL)
        return 'rawUrl'
      }
    }

    for (const attr of attrList) {
      const match = [...attr.value.matchAll(urlRegex)]
      if (match.length === 0) continue
      if (match.length === 1) {
        const newURL = match[0][0].replace(/https?:/, protocol)
        const lazySize = await getImageSize(newURL)
        if (lazySize < naturalSize) continue

        updateImageSource(img, newURL)
        return attr.name
      }
      if (match.length > 1) {
        const first = match[0][0].replace(/https?:/, protocol)
        const last = match[match.length - 1][0].replace(/https?:/, protocol)
        const [firstSize, LastSize] = await Promise.all([getImageSize(first), getImageSize(last)])
        if (firstSize < naturalSize && LastSize < naturalSize) continue

        const large = LastSize > firstSize ? last : first
        updateImageSource(img, large)
        return attr.name
      }
    }
  }

  async function getImageBitSize(src) {
    console.log(`Fetch bit size of ${src}`)
    try {
      const res = await fetch(src, {method: 'HEAD'})
      const size = res.headers.get('Content-Length')
      return typeof size === 'string' ? parseInt(size) : 0
    } catch (e) {
      return 0
    }
  }

  function getImageRealSize(src) {
    return new Promise(resolve => {
      console.log(`Fetch image size of ${src}`)
      const img = new Image()
      img.onload = () => resolve(img.naturalWidth)
      img.onerror = () => resolve(0)
      img.src = src
      setTimeout(() => resolve(0), 3000)
    })
  }

  function updateImageSource(img, src) {
    img.src = src
    img.srcset = src

    const picture = img.parentNode
    if (picture.tagName !== 'PICTURE') return
    const sources = picture.querySelectorAll('source')
    for (const source of sources) {
      source.srcset = src
    }
  }

  return {
    closeImageViewer: function () {
      document.documentElement.classList.remove('has-image-viewer')
      const viewer = document.querySelector('.__shadow__image-viewer')
      if (viewer) {
        viewer.addEventListener('transitionend', viewer.remove)
        viewer.style.transition = 'opacity 0.2s'
        viewer.style.opacity = '0'
      }
    },

    simpleUnlazyImage: async function () {
      const imgList = document.querySelectorAll('img:not(.simpleUnlazy)')
      const listSize = imgList.length
      if (!listSize) return

      console.log('Try to unlazy image')
      console.log(`${listSize} image found`)

      const asyncList = []
      for (const img of imgList) {
        img.classList.add('simpleUnlazy')
        asyncList.push(checkImageAttr(img))
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

      return options.svgFilter
        ? [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
        : [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
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

      return options.svgFilter
        ? [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank' && !url.includes('.svg'))
        : [...new Set(imageUrls)].filter(url => url !== '' && url !== 'about:blank')
    }
  }
})()
