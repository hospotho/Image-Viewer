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
      const imageDataList = []
      for (const img of document.getElementsByTagName('img')) {
        imageDataList.push([img.currentSrc, img])
      }

      for (const node of document.querySelectorAll('*')) {
        const bg = window.getComputedStyle(node).backgroundImage
        if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
          imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
        }
      }

      for (const video of document.querySelectorAll('video[poster]')) {
        imageDataList.push([video.poster, video])
      }

      const badImage = options.svgFilter
        ? url => {
            url === '' || url === 'about:blank' || url.includes('.svg')
          }
        : url => {
            url === '' || url === 'about:blank'
          }

      const uniqueImage = []
      outer: for (const img of imageDataList) {
        if (badImage(img[0])) continue outer
        for (const unique of uniqueImage) {
          if (img[0] === unique[0]) continue outer
        }
        uniqueImage.push(img)
      }

      return uniqueImage
    },

    getImageList: function (options) {
      const imageDataList = []
      for (const img of document.getElementsByTagName('img')) {
        if (img.offsetParent === null && img.style.position !== 'fixed') continue
        const pass = (img.clientWidth >= options.minWidth || img.naturalWidth >= options.minWidth) && (img.clientHeight >= options.minHeight || img.naturalHeight >= options.minHeight)
        if (pass || !img.complete) {
          imageDataList.push([img.currentSrc, img])
        }
      }

      for (const node of document.querySelectorAll('*')) {
        if (node.clientWidth < options.minWidth || node.clientWidth < options.minHeight) continue
        const bg = window.getComputedStyle(node).backgroundImage
        if (bg?.indexOf('url') === 0 && bg.indexOf('.svg') === -1) {
          imageDataList.push([bg.substring(4, bg.length - 1).replace(/['"]/g, ''), node])
        }
      }

      for (const video of document.querySelectorAll('video[poster]')) {
        if (video.clientWidth >= options.minWidth && video.clientHeight >= options.minHeight) {
          imageDataList.push([video.poster, video])
        }
      }

      const badImage = options.svgFilter
        ? url => {
            url === '' || url === 'about:blank' || url.includes('.svg')
          }
        : url => {
            url === '' || url === 'about:blank'
          }

      const uniqueImage = []
      outer: for (const img of imageDataList) {
        if (badImage(img[0])) continue outer
        for (const unique of uniqueImage) {
          if (img[0] === unique[0]) continue outer
        }
        uniqueImage.push(img)
      }

      return uniqueImage
    },

    sortImageDataList: function (dataList) {
      const imageDomList = []
      for (const data of dataList) {
        if (typeof data[1] === 'string') {
          for (const iframe of document.getElementsByTagName('iframe')) {
            if (data[1] === iframe.src) {
              imageDomList.push([data[0], iframe])
            }
          }
        } else {
          imageDomList.push([...data])
        }
      }

      imageDomList.sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))

      const sortedDataList = []
      for (const data of imageDomList) {
        if (data[1].tagName === 'IFRAME') {
          sortedDataList.push([data[0], data[1].src])
        } else {
          sortedDataList.push(data[0])
        }
      }

      return sortedDataList
    },

    dataURLToObjectURL: function (dataURL) {
      const arr = dataURL.split(',')
      const mime = arr[0].match(/:(.*?);/)[1]
      const bstr = atob(arr[1])
      let n = bstr.length
      const u8arr = new Uint8Array(n)
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n)
      }
      return URL.createObjectURL(new Blob([u8arr], {type: mime}))
    },

    getWapperSize: function (dom) {
      const wrapper = dom.closest('div')
      if (!wrapper || wrapper.classList.length === 0) return

      const classList = '.' + [...wrapper.classList].join('.')
      const allWrapperDivs = document.querySelectorAll(`div${classList}`)
      if (allWrapperDivs.length < 4) return

      const width = []
      const height = []
      for (const div of allWrapperDivs) {
        // ad may use same wrapper and adblock set it to display: none
        if (div.offsetParent === null && div.style.position !== 'fixed') continue
        width.push(div.clientWidth)
        height.push(div.clientHeight)
      }
      if (new Set(width).size !== 1 || new Set(height).size !== 1) return

      if (width[0] * 1.5 > dom.clientHeight && height[0] * 1.5 > dom.clientHeight) {
        return [width[0] - 10, height[0] - 10]
      }
    }
  }
})()
